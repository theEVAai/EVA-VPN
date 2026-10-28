'use strict';

// Also applies to direct electron-builder invocations outside CI.
exports.default = async () => { await import('../scripts/check-syntax.mjs'); };
