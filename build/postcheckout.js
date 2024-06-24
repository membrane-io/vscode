const { execSync } = require('child_process');
const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();

// Show a warning if the current branch is `main` since we don't use it for Membrane but it's easy to work on it by
// accident.
if (branch === 'main') {
	console.log(`${'='.repeat(60)}`);
	console.log(`${' '.repeat(60)}`);
	console.log('  WARNING: You are on the `main` branch. You probably meant to use `membrane-web`');
	console.log(`${' '.repeat(60)}`);
	console.log(`${'='.repeat(60)}`);
}
