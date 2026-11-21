# Demo data for the local Canvas. scripts/local-canvas-seed.sh runs this in
# Canvas's web container with rails runner.
#
# It creates, or brings up to date, one semester: 3 published courses, 3
# teachers and 6 students with active enrollments, and in each course
# assignments (one of them a quiz) and calendar events. Every date is a whole
# number of days from the day it runs, in the Mac's time zone (CUE_SEED_TZ),
# so running it again moves everything to the new day.
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

module CueDemoSeed
  ZONE = ActiveSupport::TimeZone[ENV["CUE_SEED_TZ"].to_s] || ActiveSupport::TimeZone["UTC"]
  TODAY = ZONE.today
  POINTS_PER_QUESTION = 5

  # Assignments: title, due day (days from today; nil for no due date), points,
  # submission type. Due at 23:59. Cue takes a title with the word exam,
  # midterm, final or test in it for an exam, so only exams use those words.
  # Quiz questions: the question, the right answer, then the wrong ones.
  # Events: title, day, and start and end times, or all day.
  COURSES = [
    {
      code: "CS 4350",
      name: "Software Engineering",
      teacher: "Elena Marsh",
      assignments: [
        ["Homework 1: User Stories", -17, 20, "online_text_entry"],
        ["Project Milestone 1: Requirements", -6, 50, "online_upload"],
        ["Homework 2: UML Class Diagrams", 10, 25, "online_upload"],
        ["Midterm Exam", nil, 100, "on_paper"],
        ["Project Milestone 2: Design Review", 24, 75, "online_upload"],
        ["Homework 3: Unit Testing", 38, 25, "online_upload"],
        ["Project Milestone 3: Release", 66, 150, "online_upload"]
      ],
      quiz: {
        title: "Quiz 1: Version Control",
        due: 3,
        questions: [
          ["Which Git command records staged changes in the repository?",
           "git commit", "git add", "git push", "git status"],
          ["What does a pull request ask for?",
           "A review before the changes are merged", "A copy of another repository",
           "Deleting a branch", "Undoing the last commit"],
          ["Which file tells Git which files to leave untracked?",
           ".gitignore", ".gitconfig", "README.md", ".gitattributes"]
        ]
      },
      events: [
        { title: "Review session (Room 115)", day: 27, from: [16, 0], to: [17, 30] }
      ]
    },
    {
      code: "CS 4513",
      name: "Database Systems",
      teacher: "David Okafor",
      assignments: [
        ["Homework 1: ER Diagrams", -20, 30, "online_upload"],
        ["Homework 2: Relational Algebra", -11, 30, "online_upload"],
        ["Project Part 1: Schema Design", 6, 60, "online_upload"],
        ["Midterm Exam", 16, 100, "on_paper"],
        ["Homework 3: Normalization", 30, 30, "online_upload"],
        ["Project Part 2: Query Optimization", 52, 80, "online_upload"]
      ],
      quiz: {
        title: "Quiz 1: SQL Basics",
        due: 2,
        questions: [
          ["Which SQL clause filters rows before they are grouped?",
           "WHERE", "HAVING", "ORDER BY", "LIMIT"],
          ["Which join returns only the rows that have a match in both tables?",
           "INNER JOIN", "LEFT JOIN", "FULL OUTER JOIN", "CROSS JOIN"],
          ["Which constraint stops a column from holding the same value twice?",
           "UNIQUE", "NOT NULL", "DEFAULT", "CHECK"]
        ]
      },
      events: [
        { title: "Final exam (Room 210)", day: 62, from: [10, 0], to: [12, 0] }
      ]
    },
    {
      code: "STAT 3303",
      name: "Applied Statistics",
      teacher: "Priya Raman",
      assignments: [
        ["Problem Set 1: Descriptive Statistics", -14, 20, "online_upload"],
        ["Problem Set 2: Probability", -3, 20, "online_upload"],
        ["Midterm Exam", 12, 100, "on_paper"],
        ["Problem Set 3: Hypothesis Testing", 19, 25, "online_upload"],
        ["Project Proposal", 26, 40, "online_text_entry"],
        ["Problem Set 4: Linear Regression", 45, 25, "online_upload"],
        ["Project Report", 68, 100, "online_upload"]
      ],
      quiz: {
        title: "Quiz 1: Sampling Distributions",
        due: 1,
        questions: [
          ["As the sample size grows, the standard error of the mean...",
           "gets smaller", "gets larger", "stays the same", "becomes the population mean"],
          ["By the Central Limit Theorem, for large samples the sampling distribution of the mean is roughly...",
           "normal", "uniform", "skewed right", "the same shape as the population"],
          ["A sample of 100 has a standard deviation of 20. What is the standard error of the mean?",
           "2", "0.2", "20", "200"]
        ]
      },
      events: [
        { title: "Project demo day", day: 40, all_day: true }
      ]
    }
  ].freeze

  # Each student's courses: 2 or 3 each, and some in all three.
  STUDENTS = [
    ["Maya Thompson", ["CS 4350", "CS 4513", "STAT 3303"]],
    ["Liam Novak", ["CS 4350", "CS 4513"]],
    ["Aisha Bello", ["CS 4350", "STAT 3303"]],
    ["Diego Alvarez", ["CS 4513", "STAT 3303"]],
    ["Hannah Schmidt", ["CS 4350", "CS 4513", "STAT 3303"]],
    ["Wei Chen", ["CS 4350", "STAT 3303"]]
  ].freeze

  module_function

  def run
    account = Account.default
    people = COURSES.map { |course| person(course[:teacher], "teacher", [course[:code]]) } +
             STUDENTS.map { |name, codes| person(name, "student", codes) }
    stop_if_an_email_is_taken(account, people)

    user_ids = {}
    ActiveRecord::Base.transaction do
      term = seed_term(account)
      courses = {}
      COURSES.each { |data| courses[data[:code]] = seed_course(account, term, data) }
      people.each do |p|
        user = seed_user(account, p)
        p[:codes].each { |code| enroll(courses.fetch(code), user, p[:role]) }
        user_ids[p[:email]] = user.id
      end
      COURSES.each do |data|
        course = courses.fetch(data[:code])
        data[:assignments].each { |a| seed_assignment(course, *a) }
        seed_quiz(course, data[:quiz])
        data[:events].each { |e| seed_event(course, e) }
      end
    end

    people.each do |p|
      puts ["CUE_ACCOUNT", p[:role], p[:name], p[:email], p[:password], user_ids.fetch(p[:email]),
            p[:codes].join("; ")].join("\t")
    end
    puts "CUE_COURSES\t#{COURSES.size}"
  end

  def person(name, role, codes)
    first, last = name.downcase.split(" ", 2)
    domain = (role == "teacher") ? "faculty.cue-demo.test" : "students.cue-demo.test"
    { name: name, role: role, codes: codes,
      email: "#{first}.#{last}@#{domain}",
      sis_user_id: "cue-demo-#{first}-#{last}",
      password: "#{first}-cue2026" }
  end

  # Midnight at the start of the day <offset> days from today, in the Mac's zone.
  def day_start(offset)
    date = TODAY + offset
    ZONE.local(date.year, date.month, date.day)
  end

  def day_at(offset, hour, minute)
    day_start(offset).change(hour: hour, min: minute)
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

  def seed_term(account)
    season = case TODAY.month
             when 1..5 then "Spring"
             when 6..7 then "Summer"
             else "Fall"
             end
    term = account.enrollment_terms.find_or_initialize_by(sis_source_id: "cue-demo-term")
    term.name = "#{season} #{TODAY.year}"
    term.start_at = day_start(-42)
    term.end_at = day_start(70).end_of_day
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

  def seed_assignment(course, title, due, points, submission_type)
    assignment = course.assignments.active.find_by(title: title) || course.assignments.build(title: title)
    assignment.due_at = due && day_at(due, 23, 59)
    assignment.points_possible = points
    assignment.grading_type = "points"
    assignment.submission_types = submission_type
    assignment.workflow_state = "published"
    assignment.save_without_broadcasting!
  end

  # A graded quiz. Publishing it publishes the assignment Canvas made for it
  # (submission type online_quiz) and sets the points from its questions.
  def seed_quiz(course, data)
    quiz = course.quizzes.active.find_by(title: data[:title]) || course.quizzes.build(title: data[:title])
    quiz.quiz_type = "assignment"
    quiz.due_at = day_at(data[:due], 23, 59)
    quiz.shuffle_answers = true
    quiz.save! if quiz.new_record? # questions need the quiz's id
    if quiz.quiz_questions.active.none?
      data[:questions].each_with_index do |(text, *answers), i|
        choices = answers.each_with_index.map { |answer, j| { text: answer, weight: j.zero? ? 100 : 0 } }
        quiz.quiz_questions.create!(question_data: {
          question_name: "Question #{i + 1}",
          question_type: "multiple_choice_question",
          question_text: text,
          points_possible: POINTS_PER_QUESTION,
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
      event.start_at = day_at(data[:day], *data[:from])
      event.end_at = day_at(data[:day], *data[:to])
    end
    event.workflow_state = "active"
    event.save_without_broadcasting!
  end
end

Time.zone = CueDemoSeed::ZONE
CueDemoSeed.run
