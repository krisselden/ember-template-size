const path = require("path");
const vm = require("vm");
const fs = require("fs");

const COMPILERS_DIR = path.resolve(__dirname, `../compilers`);
const VERSION_REGEX = /^ember-template-compiler_(.*).js$/;

module.exports.compilerVersions = () => {
  const versions = [];
  for (const entry of fs.readdirSync(COMPILERS_DIR)) {
    const match = VERSION_REGEX.exec(entry);
    if (match !== null) {
      versions.push(match[1]);
    }
  }
  return versions;
};

/**
 * @param {string} version
 */
function compilerFilename(version) {
  return path.join(COMPILERS_DIR, `ember-template-compiler_${version}.js`);
}

/**
 * @param {SharedCode} sharedCode
 */
module.exports.templateCompilerFromShared = function templateCompilerFromShared(
  sharedCode
) {
  const script = new vm.Script(Buffer.from(sharedCode.code).toString("utf8"), {
    cachedData: Buffer.from(sharedCode.cachedData),
    filename: sharedCode.filename
  });
  if (/** @type {any} */ (script).cachedDataRejected) {
    console.warn("Script cached data rejected");
  }
  const context = templateCompilerContext();
  script.runInContext(context);
  return context.module.exports.precompile;
};

/**
 * @param {string} version
 */
module.exports.sharedTemplateCompilerCode = function sharedTemplateCompilerCode(
  version
) {
  const filename = compilerFilename(version);
  const code = sharedBufferForFile(filename);
  const script = new vm.Script(readFileSync(filename, code), { filename });
  const cachedData = getSharedCachedData(script);
  return { version, filename, code, cachedData };
};

/**
 * @param {import("vm").Script} templateCompilerScript
 */
function getSharedCachedData(templateCompilerScript) {
  const context = templateCompilerContext();
  templateCompilerScript.runInContext(context);
  const { precompile } = context.module.exports;
  precompile(`
<div>
    {{#if show}}
        {{#let (helper-x 1 2) as |a b|}}
            {{some-helper a b c=(another-helper 1 2)}}
        {{/let}}
        <MyComponent @arg1=1234 @arg2={{this.x}} class="foo" data-something={{this.y}} as |x|>
            {{x}}
            <button {{on "click" this.doSomething}}>Click Me!</button>
        </MyComponent>
    {{else}}
        Something else.
    {{/if}}
</div>
`);
  const cachedData = templateCompilerScript.createCachedData();
  const sharedBuffer = new SharedArrayBuffer(cachedData.byteLength);
  Buffer.from(sharedBuffer).set(cachedData);
  return sharedBuffer;
}

function templateCompilerContext() {
  return /** @type {{module:{exports:{precompile(templateSource: string): string}}}} */ (vm.createContext(
    {
      module: { require, exports: {} },
      require
    }
  ));
}

/**
 * @param {string} filename
 * @param {SharedArrayBuffer} sharedArrayBuffer
 */
function readFileSync(filename, sharedArrayBuffer) {
  const buffer = Buffer.from(sharedArrayBuffer);
  const size = sharedArrayBuffer.byteLength;
  const fd = fs.openSync(filename, "r");
  try {
    let pos = 0;
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, pos, size - pos, pos);
      pos += bytesRead;
    } while (bytesRead !== 0 && pos < size);
  } finally {
    fs.closeSync(fd);
  }
  return buffer.toString("utf8");
}

/**
 * @param {string} filename
 */
function sharedBufferForFile(filename) {
  const { size } = fs.statSync(filename);
  return new SharedArrayBuffer(size);
}
