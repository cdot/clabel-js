/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
import { promises as Fs } from "fs";
import Path from "path";
import Cors from "cors";
import Express from "express";
import HTTP from "http";
// Using Sharp for image processing
import Sharp from "sharp";

import { PTouch } from "./PTouch.js";
import { PTouchStub } from "./PTouchStub.js";

// Header for a base64 encoded PNG datUrl
const PNGhead = "data:image/png;base64,";

/**
 * A server for handling print commands sent to a PTouch label printer.
 * Routes
 * GET /<doc> - serve a static document from ../../ui
 * GET /ajax/info - get information about the printer
 * POST /ajax/print - print an image sent in a PNG dataurl
 * POST /ajax/eject - eject the tape so it can be cut
 */
class Server {

  /**
   * Handle an incoming print request. The image to be printed is assumed
   * to have the long edge along the X-axis.
   * @private
   */
  POST_print(req, res) {
    // Reconstruct a Buffer from the dataUrl
    const buff = Buffer.from(
      req.body.png.substr(PNGhead.length), 'base64');
    const sim = new Sharp(buff);
    sim
    .rotate(90)
    // trim background defaults to top-left pixel, but we want it to
    // be r:0,g:0,b:0,a:0. This might cause problems for images.
    .trim({ lineArt: true, background: "rgba(0,0,0,0)" })
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      /* c8 ignore next 2 */
      this.debug(info);
      this.debug(data.join(","));
      
      return this.printer.printImage(
        data, info.width, info.height, info.channels);
    });
  }

  /**
   * Handle an info request. This simply slaps the printer.
   */
  GET_info(req, res) {
    this.printer.getStatus()
    .then(info => {
      res.status(200).send(info);
    });
  }

  /**
   * Handle an incoming image save request. Used for debugging.
   * @private
   */
  POST_save(req, res) {
    const filename = req.params.filename;
    // Reconstruct a Buffer from the dataUrl
    const buff = Buffer.from(
      req.body.png.substr(PNGhead.length), 'base64');
    const sim = new Sharp(buff);
    sim
    // Rotate it so the orientation matches what the printer expects
    .rotate(90)
    .toFile(filename);
  }

  /**
   * Eject the tape from the printer
   * @private
   */
  POST_eject(req, res) {
    this.printer.eject();
  }

  /**
   * @param {object} params
   * @param {string} params.device print device
   * @param {function?} params.debug debug print function
   */
  constructor(params = {}) {

    /* c8 ignore next */
    this.debug = params.debug || function() {};

    /**
     * List of sockets connected to this server
     * @member {socket[]}
     * @private
     */
    this.clients = [];

    if (params.device == "sim")
      this.printer = new PTouchStub(params);
    else
      this.printer = new PTouch(params);

    /* c8 ignore start */
    process.on("unhandledRejection", reason => {
      // Our Express handlers may have some long promise chains, and
      // we want to be able to abort those chains on an error. To do
      // this we `throw` an `Error` that has `isHandled` set. That
      // error will cause an unhandledRejection, but that's OK, we can
      // just ignore it.
      if (reason && reason.isHandled)
        return;

      console.error("unhandledRejection", reason, reason ? reason.stack : "");
    });
    /* c8 ignore stop */

    /**
     * Express server
     * @member {Express}
     * @private
     */
    this.express = new Express();
    this.express.use(Cors());

    // Parse incoming requests with url-encoded payloads
    this.express.use(Express.urlencoded({ extended: true }));

    // Parse incoming requests with a JSON body
    this.express.use(Express.json());

    // Grab all static files relative to the project root
    // html, images, css etc. The Content-type should be set
    // based on the file mime type (extension) but Express doesn't
    // always get it right.....
    /* c8 ignore next */
    this.debug(`static files from ${params.docRoot}`);

    this.express.use(Express.static(params.docRoot));

    const cmdRouter = Express.Router();

    // 
    cmdRouter.get(
      "/",
      (req, res) => res.sendFile(
        Path.join(params.docRoot, "UI.html"),
        err => {
          if (err)
            console.error(err, "\n*** Failed to load html ***");
        }
      ));

    cmdRouter.post(
      "/ajax/print",
      (req, res) => this.POST_print(req, res));

    cmdRouter.get(
      "/ajax/info",
      (req, res) => this.GET_info(req, res));

    cmdRouter.post(
      "/ajax/eject",
      (req, res) => this.POST_eject(req, res));

    this.express.use(cmdRouter);
  }

  listen(port, host) {
    // Don't start the server until the printer has successfully been
    // initialised
    this.printer.initialise()
    .then(() => {
      // Could also use HTTPS, but why bother?
      const protocol = HTTP.Server(this.express);
      protocol.listen(port, "localhost");
    });
  }
}

export { Server }
