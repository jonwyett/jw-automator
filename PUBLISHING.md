# Publishing Checklist for jw-automator

## Pre-Publish Verification

### 1. Run Tests
```bash
npm test
```
All tests should pass (currently 86 tests).

### 2. Verify Package Contents
```bash
npm pack --dry-run
```
Should show ~16 files, ~21 kB package size.

### 3. Check Version
Ensure `package.json` version is correct: `3.0.0`

### 4. Verify Documentation
- [ ] README.md is up to date
- [ ] CHANGELOG.md reflects current version
- [ ] Examples work correctly

### 5. Test Local Installation
```bash
npm pack
npm install -g jw-automator-3.0.0.tgz
# Test the installed package
node -e "const Automator = require('jw-automator'); console.log('Success!');"
npm uninstall -g jw-automator
rm jw-automator-3.0.0.tgz
```

## Publishing

### First Time Setup
```bash
npm login
```

### Publish to npm
```bash
# Dry run first to verify
npm publish --dry-run

# Actual publish
npm publish
```

### Post-Publish
```bash
# Tag the release in git
git tag v3.0.0
git push origin v3.0.0

# Verify on npm
npm view jw-automator
```

## What Gets Published

The package includes:
- ✅ `src/` - All source code
- ✅ `docs/` - User documentation
- ✅ `examples/` - Example scripts
- ✅ `index.js` - Entry point
- ✅ `README.md` - Main documentation
- ✅ `CHANGELOG.md` - Version history
- ✅ `package.json` - Package metadata

Excluded:
- ❌ `tests/` - Test files
- ❌ `__snapshots__/`, `__backup__/` - Development artifacts
- ❌ `dev/`, `.vscode/` - Development folders
- ❌ `VERSION_HISTORY.md`, `PROJECT_SUMMARY.md` - Internal docs
- ❌ `.git/`, `node_modules/` - Standard exclusions

## Troubleshooting

### Wrong files in package
- Check `.npmignore` and `files` field in `package.json`
- Run `npm pack --dry-run` to preview

### Tests failing
- Run `npm test` locally first
- Check Node.js version (requires >=12.0.0)

### Version conflict
- Increment version in `package.json`
- Update `CHANGELOG.md`
- Cannot publish same version twice

## Notes

- Package name: `jw-automator`
- Registry: https://registry.npmjs.org
- Size limit: Keep under 100 kB (currently ~21 kB)
- Zero runtime dependencies
