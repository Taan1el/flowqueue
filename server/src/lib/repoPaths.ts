import fs from 'node:fs';
import path from 'node:path';

// Walks up from `startDir` looking for the nearest package.json whose
// "name" field equals `packageName`, and returns the directory that
// contains it.
//
// Locating directories by identity (a package name) instead of a fixed
// number of ".." segments matters here because this file's own directory
// depth relative to the repo root is NOT constant: running via `tsx` (dev)
// executes the TypeScript source directly, so import.meta.url points at
// server/src/..., but the compiled build lands one level deeper, at
// server/dist/server/src/... (server/tsconfig.json's rootDir spans both
// server/src and ../shared, see that file for why). A hardcoded relative
// path that is correct for one is wrong for the other.
export function findPackageDir(startDir: string, packageName: string): string {
  let dir = startDir;
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === packageName) return dir;
      } catch {
        // Unparsable package.json on the way up; keep looking.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find a package.json named "${packageName}" above ${startDir}`);
    }
    dir = parent;
  }
}
