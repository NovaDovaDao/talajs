---
'@talajs/contracts': patch
'@talajs/db': patch
'@talajs/api': patch
'@talajs/admin': patch
---

Published `package.json` files no longer declare the development-only `@talajs/source` export condition, which pointed at TypeScript sources that aren't included in the packages.
