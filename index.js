#!/usr/bin/env node

const compileTemplates = require("./worker/compile_templates");
const walkSync = require("walk-sync");
const readline = require("readline");
const fs = require("fs");
const parsedArgs = require("minimist")(process.argv);

const DEFAULT_GLOB = ["**/*.hbs"];
const DEFAULT_IGNORE = [
  "**/node_modules",
  ".git",
  "tmp",
  "dist",
  "config",
  "build"
];
const DEFAULT_OUTPUT = "template-size-report.json";

const [, scriptPath, inputPath] = parsedArgs._;

if (inputPath === undefined) {
  usage();
  process.exitCode = 1;
} else if (parsedArgs.h || parsedArgs.help) {
  usage();
} else {
  main(inputPath, parsedArgs).catch(err => {
    console.error("%O", err);
    process.exitCode = 1;
  });
}

/**
 * @param {string} inputPath
 * @param {import("minimist").ParsedArgs} args
 */
async function main(inputPath, args) {
  const globs = makeArray(args.glob, DEFAULT_GLOB);
  const ignore = makeArray(args.ignore, DEFAULT_IGNORE);
  const outputPath = withDefault(args.output, DEFAULT_OUTPUT);

  const { stdout } = process;

  let pos = 0;

  /** @param {string} msg */
  const status = msg => {
    if (pos > 0) {
      readline.moveCursor(stdout, -pos, 0);
      readline.clearLine(stdout, 1);
    }
    stdout.write(msg);
    pos = msg.length;
  };

  /** @param {string} msg */
  const update = msg => {
    readline.clearLine(stdout, 1);
    stdout.write(msg);
    readline.moveCursor(stdout, -msg.length, 0);
  };

  // hide cursor
  stdout.write("\x1B[?25l");
  /** @type {CompileResult[]} */
  let results;
  try {
    status("finding templates...");
    const queue = walkSync(inputPath, { globs, ignore, includeBasePath: true });
    const total = queue.length;

    status(`compiling ${total} templates...`);
    const interval = setInterval(() => {
      const progress = Math.floor(((total - queue.length) / (total + 1)) * 100);
      update(` ${progress}%`);
    }, 200);
    try {
      results = await compileTemplates(queue);
    } finally {
      clearInterval(interval);
    }
  } finally {
    status("");
    // show cursor
    stdout.write("\x1B[?25h");
  }

  const summary = summarize(results);
  const report = { results, summary };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log(summary);
}

function usage() {
  const cmd = require("path").basename(scriptPath);
  console.error(
    `${cmd} [options] <path>

--output path [default: ${DEFAULT_OUTPUT}]
--glob pattern [default: ${DEFAULT_GLOB.join(" ")}]
--ignore pattern [default: ${DEFAULT_IGNORE.join(" ")}]
`
  );
}

/**
 * @param {string|string[]|undefined} value
 * @param {string[]} defaultValue
 */
function makeArray(value, defaultValue) {
  return value === undefined
    ? defaultValue
    : Array.isArray(value)
    ? value
    : [value];
}

/**
 * @param {string | undefined} value
 * @param {string} defaultValue
 */
function withDefault(value, defaultValue) {
  return value === undefined ? defaultValue : value;
}

/**
 * @param {CompileResult[]} results
 */
function summarize(results) {
  /** @type {{[version: string]: SummarizedResult}} */
  const totals = {};
  for (const result of results) {
    const { version, original, compiled, brotli, gzip } = result;
    if (totals[version] === undefined) {
      totals[version] = {
        version,
        original,
        compiled,
        brotli,
        gzip
      };
    } else {
      const total = totals[version];
      total.original += original;
      total.compiled += compiled;
      total.gzip += brotli;
      total.brotli += brotli;
    }
  }
  return totals;
}
