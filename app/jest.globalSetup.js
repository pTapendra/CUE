// Every test runs in the same zone, whatever the machine or CI uses: Chicago is never UTC and has DST,
// so a day-boundary bug that only shows outside UTC cannot slip through.
module.exports = async () => {
  process.env.TZ = 'America/Chicago';
};
