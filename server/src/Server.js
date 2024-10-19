/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
/* eslint-env node */
/* global Buffer*/
/* global process */

import Path from "path";
import Cors from "cors";
import Express from "express";
import { Server as SocketServer } from "socket.io";
import HTTP from "http";
// Using Sharp for image processing
import Sharp from "sharp";

import { PTouch } from "./PTouch.js";

// Header for a base64 encoded PNG datUrl
const PNGhead = "data:image/png;base64,";

/**
 * A server for printing labels on a PTouch label printer.
 * Routes:
 * - GET /<doc> - serve a static document
 * - GET /ajax/info - get information about the printer
 * - POST /ajax/print - print an image sent in a PNG dataurl
 * - POST /ajax/eject - eject the tape so it can be cut
 */
class Server {

  /**
   * Handle an incoming print request. The image to be printed is assumed
   * to have the long edge along the X-axis. It can be wider than the tape
   * width, in which case it will be broken up into tape runs.
   * @private
   */
  POST_print(req, res) {
    // Reconstruct a Buffer from the dataUrl
    const buff = Buffer.from(
      req.body.png.substr(PNGhead.length), 'base64');
    const sim = new Sharp(buff);
    sim
    .rotate(90)
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) =>
      this.printer.printImage(data, info.width, info.height, info.channels))
    .then(() => this.printer.awaitPrinted())
    .then(() => res.status(200).send("Printed"));
  }

  /**
   * Handle an info request.
   */
  GET_info(req, res) {
    res.status(200).send(this.printer.status);
  }

  /**
   * Eject the tape from the printer
   * @private
   */
  POST_eject() {
    this.printer.eject();
  }

  /**
   * @param {object} params
   * @param {string} params.device print device
   * @param {function?} params.debug debug print function
   * @param {boolean?} params.write_only passed to printer, to disable
   * bidirectional comms.
   * @param {Model?} params.model printer model, required if write_only
   */
  constructor(params = {}) {

    /* c8 ignore next */
    this.debug = params.debug ?? function() {};

    /**
     * The printer
     */
    this.printer = new PTouch(params);

    /* c8 ignore start */
    process.on("unhandledRejection", reason => {
      // Our Express handlers may have long promise chains, and we
      // want to be able to abort those chains cleanly on a handled
      // error. To do this we can `throw` an `Error` that has
      // `isHandled` set. That error will cause an unhandledRejection,
      // but that's OK, we can just ignore it.
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
    // html, images, css etc.
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

  /**
   * Start the server listing on the given port
   * @param {number} port number
   * @param {string?} host host name (default "localhost")
   */
  listen(port, host = "localhost") {
    // Don't start the server until the printer has successfully been
    // initialised
    this.debug("Initialising printer");
    this.printer.initialise()
    .then(() => {
      this.debug("Printer initialised");
      // Could also use HTTPS, but why bother?
      const protocol = HTTP.Server(this.express);
      const io = new SocketServer(protocol);
      this.printer.on(
        PTouch.PRINTER_STATE_CHANGE,
        // broadcast to all listeners
        state => io.emit("Status", state));
      protocol.listen(port, host);
    });
  }
}

export { Server }
