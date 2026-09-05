'use strict';

const { createController } = require('./legacy.cjs');

// Native customization is retained only for explicit cleanup of 0.2.x.
// Never register the old commands, startup checks, or settings listeners.
function createMigration(vscode, context, dependencies = {}) {
  let controller;
  let disposed = false;
  function legacy() {
    if (disposed) throw new Error('Ocean Window migration is disposed.');
    return controller ||= createController(vscode, context, dependencies);
  }
  return {
    inspect: () => legacy().inspectLegacy(),
    restore: () => legacy().restoreLegacy(),
    dispose() {
      disposed = true;
      controller?.dispose();
    }
  };
}

module.exports = { createMigration };
