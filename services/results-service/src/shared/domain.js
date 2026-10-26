// Business rules shared by both architectures, so the comparison
// measures architecture rather than differences in logic.

// Nigerian university 5-point grading scale.
function gradeFor(score) {
  const s = Number(score);
  if (Number.isNaN(s) || s < 0 || s > 100) return null;
  if (s >= 70) return 'A';
  if (s >= 60) return 'B';
  if (s >= 50) return 'C';
  if (s >= 45) return 'D';
  if (s >= 40) return 'E';
  return 'F';
}

const PASSING_GRADES = ['A', 'B', 'C', 'D', 'E'];

// Maximum units a student may register in one semester.
const MAX_UNITS_PER_SEMESTER = Number(process.env.MAX_UNITS_PER_SEMESTER || 24);

const ROLES = ['student', 'lecturer', 'admin'];

module.exports = { gradeFor, PASSING_GRADES, MAX_UNITS_PER_SEMESTER, ROLES };
