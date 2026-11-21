# Loads the demo data in seed/local-canvas-seed.yml into the local Canvas.
# scripts/local-canvas-seed.sh runs this in Canvas's web container with rails
# runner and sends the YAML on stdin.
#
# It creates, or brings up to date, one semester: published courses, teachers
# and students with active enrollments, and in each course assignments, a quiz
# and calendar events. Every date is a whole number of days from the day it
# runs, in the Mac's time zone (CUE_SEED_TZ), so running it again moves
# everything to the new day.
#
# It finds its term, courses and people again by their cue-demo- SIS IDs, and
# assignments, quizzes and events by title within those courses, so nothing is
# ever duplicated. It changes nothing else: if a seed email already belongs to
# a user without the seed's SIS ID, it stops before changing anything.
# Everything is saved in one transaction, so a failure changes nothing.
#
# Prints, for the shell script to write out, one tab-separated line per account
#   CUE_ACCOUNT  role  name  email  password  canvas_user_id  course codes ("; ")
# and then
#   CUE_COURSES  number of courses

require "yaml"

module CueDemoSeed
  ZONE = ActiveSupport::TimeZone[ENV["CUE_SEED_TZ"].to_s] || ActiveSupport::TimeZone["UTC"]
  TODAY = ZONE.today

  module_function

  def run(data)
    account = Account.default
    accounts = data.fetch(:accounts)
    course_data = data.fetch(:courses)
    people = course_data.map { |course| person(accounts, course[:teacher], "teacher", [course[:code]]) } +
             data.fetch(:students).map { |s| person(accounts, s[:name], "student", s[:courses]) }
    stop_if_an_email_is_taken(account, people)

    user_ids = {}
    ActiveRecord::Base.transaction do
      term = seed_term(account, data.fetch(:term))
      courses = {}
      course_data.each { |c| courses[c[:code]] = seed_course(account, term, c) }
      people.each do |p|
        user = seed_user(account, p)
        p[:codes].each { |code| enroll(courses.fetch(code), user, p[:role]) }
        user_ids[p[:email]] = user.id
      end
      course_data.each do |c|
        course = courses.fetch(c[:code])
        c[:assignments].each { |a| seed_assignment(course, a) }
        seed_quiz(course, c[:quiz], data.fetch(:quiz_question_points))
        c[:events].each { |e| seed_event(course, e) }
      end
    end

    people.each do |p|
      puts ["CUE_ACCOUNT", p[:role], p[:name], p[:email], p[:password], user_ids.fetch(p[:email]),
            p[:codes].join("; ")].join("\t")
    end
    puts "CUE_COURSES\t#{course_data.size}"
  end

  def person(accounts, name, role, codes)
    first, last = name.downcase.split(" ", 2)
    domain = (role == "teacher") ? accounts.fetch(:teacher_email_domain) : accounts.fetch(:student_email_domain)
    { name: name, role: role, codes: codes,
      email: "#{first}.#{last}@#{domain}",
      sis_user_id: "cue-demo-#{first}-#{last}",
      password: "#{first}#{accounts.fetch(:password_suffix)}" }
  end

  # Midnight at the start of the day <offset> days from today, in the Mac's zone.
  def day_start(offset)
    date = TODAY + offset
    ZONE.local(date.year, date.month, date.day)
  end

  def day_at(offset, hour, minute)
    day_start(offset).change(hour: hour, min: minute)
  end

  # "16:30" -> [16, 30]
  def hour_and_minute(time)
    hour, minute = time.to_s.split(":", 2)
    [Integer(hour, 10), Integer(minute, 10)]
  end

  # A login (pseudonym) with a seed email that the seed didn't make means a
  # person made by hand: stop, naming every such email, before changing anything.
  def stop_if_an_email_is_taken(account, people)
    taken = people.select do |p|
      Pseudonym.active.by_unique_id(p[:email]).any? do |login|
        login.account_id != account.id || login.sis_user_id != p[:sis_user_id]
      end
    end
    return if taken.empty?

    messages = taken.map do |p|
      "#{p[:email]} already belongs to a Canvas user the seed didn't create; rename or delete that user first."
    end
    abort messages.join("\n")
  end

  def seed_term(account, data)
    season = case TODAY.month
             when 1..5 then "Spring"
             when 6..7 then "Summer"
             else "Fall"
             end
    term = account.enrollment_terms.find_or_initialize_by(sis_source_id: "cue-demo-term")
    term.name = "#{season} #{TODAY.year}"
    term.start_at = day_start(data.fetch(:starts_day))
    term.end_at = day_start(data.fetch(:ends_day)).end_of_day
    term.workflow_state = "active"
    term.save!
    term
  end

  # Published (offered), and taken out of the trash if it was deleted.
  def seed_course(account, term, data)
    course = account.all_courses.find_or_initialize_by(sis_source_id: "cue-demo-#{data[:code].delete(" ").downcase}")
    course.account = account
    course.name = data[:name]
    course.course_code = data[:code]
    course.enrollment_term = term
    course.start_at = term.start_at
    course.conclude_at = term.end_at
    course.save!
    course.undelete! if course.deleted?
    course.offer! unless course.available?
    course
  end

  # The user and their login, found by the login's SIS ID (deleted ones too,
  # as Canvas keeps SIS IDs on deleted logins). Sets the password every time.
  def seed_user(account, p)
    login = account.pseudonyms.find_by(sis_user_id: p[:sis_user_id])
    user = login ? login.user : User.new
    restoring = user.deleted? || login&.deleted?
    user.name = p[:name]
    user.time_zone = ZONE
    if user.deleted?
      user.workflow_state = "registered"
      user.deleted_at = nil
    end
    user.save!
    user.register! unless user.registered?

    login ||= account.pseudonyms.build(user: user, sis_user_id: p[:sis_user_id])
    login.unique_id = p[:email]
    login.workflow_state = "active"
    login.deleted_at = nil
    login.password = p[:password]
    login.password_confirmation = p[:password]
    login.save!
    user.update_account_associations if restoring
    user
  end

  # Active (accepted) from the start. enroll_user reuses the user's enrollment
  # of this type in the course, whatever its state, and makes it active.
  def enroll(course, user, role)
    type = (role == "teacher") ? "TeacherEnrollment" : "StudentEnrollment"
    enrollment = course.enroll_user(user, type, enrollment_state: "active", force_update: true, no_notify: true)
    return if enrollment.persisted? && enrollment.workflow_state == "active" && !enrollment.changed?

    raise "Couldn't enroll #{user.name} in #{course.course_code}: #{enrollment.errors.full_messages.join(", ")}"
  end

  def seed_assignment(course, data)
    title = data[:title]
    assignment = course.assignments.active.find_by(title: title) || course.assignments.build(title: title)
    assignment.due_at = data[:due_day] && day_at(data[:due_day], 23, 59)
    assignment.points_possible = data[:points]
    assignment.grading_type = "points"
    assignment.submission_types = data[:submission]
    assignment.workflow_state = "published"
    assignment.save_without_broadcasting!
  end

  # A graded quiz. Publishing it publishes the assignment Canvas made for it
  # (submission type online_quiz) and sets the points from its questions.
  def seed_quiz(course, data, points_per_question)
    quiz = course.quizzes.active.find_by(title: data[:title]) || course.quizzes.build(title: data[:title])
    quiz.quiz_type = "assignment"
    quiz.due_at = day_at(data[:due_day], 23, 59)
    quiz.shuffle_answers = true
    quiz.save! if quiz.new_record? # questions need the quiz's id
    if quiz.quiz_questions.active.none?
      data[:questions].each_with_index do |q, i|
        answers = [q[:right], *q[:wrong]]
        choices = answers.each_with_index.map { |answer, j| { text: answer.to_s, weight: j.zero? ? 100 : 0 } }
        quiz.quiz_questions.create!(question_data: {
          question_name: "Question #{i + 1}",
          question_type: "multiple_choice_question",
          question_text: q[:question],
          points_possible: points_per_question,
          answers: choices
        })
      end
    end
    quiz.publish!
  end

  def seed_event(course, data)
    event = course.calendar_events.active.find_by(title: data[:title]) || course.calendar_events.build(title: data[:title])
    event.time_zone_edited = ZONE.name
    if data[:all_day]
      event.all_day = true
      event.all_day_date = TODAY + data[:day]
      event.start_at = event.end_at = day_start(data[:day])
    else
      event.all_day = false
      event.all_day_date = nil
      event.start_at = day_at(data[:day], *hour_and_minute(data[:from]))
      event.end_at = day_at(data[:day], *hour_and_minute(data[:to]))
    end
    event.workflow_state = "active"
    event.save_without_broadcasting!
  end
end

text = $stdin.read
abort "No demo data came in on stdin (expected seed/local-canvas-seed.yml)." if text.to_s.strip.empty?
Time.zone = CueDemoSeed::ZONE
CueDemoSeed.run(YAML.safe_load(text, symbolize_names: true))
