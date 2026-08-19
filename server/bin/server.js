/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
import Path from "path";
const __dirname = Path.dirname(__filename);

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
  "\t-f, --files <path> - get label files from this path (default ~/Labels)",
  "\t-m, --model <model> - set the printer type e.g. --model PT1230",
  "\t\tIf the model is not specified, the --device will be interrogated",
  "\t\t--model is required if --write_only is given",
  "\t-h, --help - output this information",
  "\t-p, --port <port> - port to start server on (default 9094)",
  "\t-v, --verbose - prints debug info to console.debug",
  "\t-w, --write_only - only write, don't try to read from the device"
].join("\n");

const go_parser = new getopt.BasicParser(
  "d:(device)h(help)m:(model)p:(port)v(verbose)w(write_only)",
  process.argv);

// Option defaults
const options = {
  port: 9094,
  installPath: Path.normalize(Path.join(__dirname, "..", "..", "browser")),
  labelsPath: `${process.env.HOME}/Labels`,
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
  case 'f': options.labelsPath =
    option.optarg.replace("~", process.env.HOME); break;
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

// Check that the file path is accessible
server.listLabels()
.catch(e => {
  console.error(`Files path ${options.labelsPath} is not accessible`);
  process.exit();
});

server.listen(options.port);

