/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
import Path from "path";
const __dirname = Path.dirname(__filename);
const docRoot = Path.normalize(Path.join(__dirname, "..", "..", "browser"));

import getopt from "posix-getopt";

import { Server } from "../src/Server.js";
import { Models } from "../src/Models.js";

const DESCRIPTION = [
  "USAGE",
  `\tnode ${Path.relative(".", process.argv[1])} [options]`,
  "DESCRIPTION",
  "\tRun a label print server for a Brother label printer",
  "OPTIONS",
  "\t-d, --device <path> - path to printer (default /dev/usb/lp0)",
  "\t-m, --model <model> - Set the printer type e.g. --model PT1230",
  "\t\tIf the model is not specified, the --device will be interrogated",
  "\t\t--model is required if --write_only is given",
  "\t-h, --help - output this information",
  "\t-p, --port <file> - Port to start server on (default 9094)",
  "\t-w, --write_only - only write, don't try to read from the device",
  "\t-v, --verbose - (prints to console.debug)"
].join("\n");

const go_parser = new getopt.BasicParser(
  "d:(device)h(help)m:(model)p:(port)v(verbose)w(write_only)",
  process.argv);

// Option defaults
const options = {
  port: 9094,
  docRoot: docRoot,
  device: "/dev/usb/lp0",
  debug: () => {}
};

function fail(message) {
  if (message)
    console.error(message);
  console.log(DESCRIPTION);
  console.log(`Supported printer models: ${Models.all().map(m => m.name).join(", ")}`);
  process.exit();
}

let option;
while ((option = go_parser.getopt())) {
  switch (option.option) {
  default: fail(`Unknown option -${option.option}\n${DESCRIPTION}`);
  case 'd': options.device = option.optarg ; break;
  case 'h': fail();
  case 'm': options.model = Models.getModelByName(option.optarg); break;
  case 'p': options.port = option.optarg ; break;
  case 'v': options.debug = console.debug; break;
  case 'w': options.write_only = true; break;
  }
}
if (process.argv.length > go_parser.optind())
  fail(`Unexpected "${process.argv[go_parser.optind()]}"`);

console.debug(
  `Starting server for device ${options.device}`,
  `on port ${options.port}`);

if (options.write_only && !options.model)
  fail("--write_only requires --model");

const server = new Server(options);
server.listen(options.port);

