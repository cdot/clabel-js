/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
/* eslint-env browser */

/**
 * User interface to capture HTML definitions of labels that can then
 * be sent (as images) to a label printer server.
 */
import { PTouchStatus } from "./PTouchStatus.js";

/* global domtoimage */

// Last status received from the server. This describes the printer.
let currentStatus = new PTouchStatus();
// Thresholds for colour conversion, tunable per image
let alphaThreshold = 30;
let colourThreshold = 30;
let tightCrop = false;
let ejectPx = 10;

// Update printer status information fields
function setStatus(s) {
  currentStatus = s;
  $(".model_name").text(s.model);
  $(".media_width_mm").text(s.media_width_mm);
  $(".printable_width_mm").text(s.printable_width_mm);
  $(".printable_width_px").text(s.printable_width_px);
  $(".phase").text(PTouchStatus.Phase[s.phase]);
  $("#review_liner").css("min-height", s.printable_width_px);
  $("#eject_mm").text((ejectPx * s.pixel_size_mm).toFixed(2));
  refreshImage();
}

/**
 * Given a Uint8Array containing 4-byte image data, trim empty rows
 * from top and bottom.
 * @param {Uint8Array} data the image data
 * @param {number} w image width
 * @param {number} h image height
 * @return {number[]} [0] = top of trimmed image [1] = new height
 */
function trim(data, w, h) {

  function keep(data, offset) {
    const r = data[offset+0], b = data[offset+1],
          g = data[offset+2], a = data[offset+3];
    return r > 0 || g > 0 || b > 0 || a > 0;
  }

  // crop the image from the top down
  let top = 0, crop = true;
  while (crop && top < h) {
    for (let x = 0; x < w; x++) {
      if (keep(data, (top * w + x) * 4)) {
        //console.debug(`First top keep at ${top},${x}`);
        crop = false;
        break;
      }
    }
    if (crop) top++;
  }

  if (top >= h) {
    // still cropping when we reached the bottom of the image
    console.debug("Image is empty");
    return [ 0, h ];
  }

  // Found at least one uncroppable row, crop up from the bottom
  let height = h - top;
  crop = true;
  while (crop && height > 0) {
    for (let x = 0; x < w; x++) {
      if (keep(data, ((top + height - 1) * w + x) * 4)) {
        //console.debug(`First bottom keep at ${height},${x}`);
        crop = false;
        break;
      }
    }
    if (crop) height--;
  }
  //console.debug(`top ${top} height ${height}`);
  return [ top, height ];
}

/**
 * Simple algorithm to convert an RGBA image to black and white.
 * Works on the data in place, simply sets black pixels as opaque and white
 * pixels as transparent.
 * @param {Uint8Array} data the image data
 * @param {number} w image width
 * @param {number} h image height
 */
function BandW(data, w, h) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w;x++) {
      const offset = ((y * w) + x) * 4;
      if (data[offset + 3] > alphaThreshold) {
        let bw = data[offset + 0] * 0.3
            + data[offset + 1] * 0.59
            + data[offset + 2] * 0.11;
        // We are painting on a white background, so colours that
        // give a higher bw are increasingly washed out and need to
        // map to white. Darker colours map to black.
        if (bw > colourThreshold)
          data[offset + 3] = 0;
        else {
          data[offset + 0] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
          data[offset + 3] = 255;
        }
      }
    }
}

/**
 * Render the review window to the image canvas.
 */
function refreshImage() {
  setTimeout(() => {
    const node = $("#review_div")[0];
    const w = node.scrollWidth;
    let top = 0;
    let h = node.scrollHeight;
    domtoimage
    // Get a Uint8Array with every 4 elements representing the RGBA data
    .toCanvas(node, {
      // SMELL: this should be w, but in that case there are labels where
      // words get left off the end - something to do with the SVG rendering,
      // probably. Seems to work OK with +1, though. h doesn't seem to be a
      // problem.
      width: w + 1,
      height: h
    })
    .then(dom_canvas => {
      // Prepare the generated canvas for rendering
      const dom_ctx = dom_canvas.getContext('2d');
      const imageData = dom_ctx.getImageData(0, 0, w, h);

      if (tightCrop)
        // Strip empty rows from top and bottom. This will centre
        // the image in the tape.
        [ top, h ] = trim(imageData.data, w, h);

      // Monochromise the image
      BandW(imageData.data, w, h);
      dom_ctx.putImageData(imageData, 0, 0);

      // Render the image onto the canvas
      const canvas = $("#image_canvas")[0];
      $("#image_liner").width(canvas.width = w);
      $("#image_liner").height(canvas.height = h);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(dom_canvas, 0, top, w, h,
                    0, 0, w, h);

      $("#label_length_px").text(w);
      $("#label_length_mm").text((w * currentStatus.pixel_size_mm).toFixed(2));

      $("#label_width_px").text(h);
      $("#label_width_mm").text((h * currentStatus.pixel_size_mm).toFixed(2));

      // If multiple tape runs are required, show the bounds of the
      // first tape run
      if (h > currentStatus.printable_width_px) {
        $("#tape_div")
        .css("top", 0)
        .css("left", "0")
        .css("height", `${currentStatus.printable_width_px}px`)
        .show();
      } else
        $("#tape_div").hide();
    });
  }, 100);
}

/**
 * Handler for the label text changing
 */
function onLabelChanged(refresh = true) {
  const content = $("#label_text").val();
  $("#review_div").html(content);
  if (refresh) refreshImage();
}

/**
 * Handler for the font family changing
 */
function onFontFamilyChanged(refresh = true) {
  const classList = $('#review_div').attr('class').split(/\s+/);
  $.each(classList, function(index, item) {
    if (item.indexOf("font-family-") === 0) {
      $("#review_div").removeClass(item);
    }
  });
  $("#review_div").addClass(`font-family-${$("#select_font").val()}`);
  if (refresh) refreshImage();
}

// Handler for the font size changing
function onFontSizeChanged(refresh = true) {
  const size = $("#font-size").val();
  $("#review_div").css("font-size", `${size}px`);
  if (refresh) refreshImage();
}

// Handler for the left margin changing
function onLeftMarginChanged(refresh = true) {
  const size = $("#left-margin").val();
  $("#review_div").css("padding-left", `${size}px`);
  if (refresh) refreshImage();
}

// Handler for the left margin changing
function onRightMarginChanged(refresh = true) {
  const size = $("#right-margin").val();
  $("#review_div").css("padding-right", `${size}px`);
  if (refresh) refreshImage();
}

// Handler to set the rendering alpha threshold
function onAlphaThresholdChanged(refresh = true) {
  alphaThreshold = $("#alpha_threshold").val();
  if (refresh) refreshImage();
}

// Handler to set the rendering colour threshold
function onColourThresholdChanged(refresh = true) {
  colourThreshold = $("#colour_threshold").val();
  if (refresh) refreshImage();
}

// Handler to set cropping
function onTightCropChanged(refresh = true) {
  tightCrop = $("#tight_crop").is(":checked");
  if (refresh) refreshImage();
}

// Handler to set eject
function onEjectChanged(refresh = true) {
  ejectPx = $("#eject_px").val();
  $("#eject_px").text((ejectPx / currentStatus.pixel_size_mm).toFixed(2));
  if (refresh) refreshImage();
}

$(function() {
  $("#label_text").on("keyup", onLabelChanged);
  onLabelChanged(false);

  $("#select_font").on("change", onFontFamilyChanged);
  onFontFamilyChanged(false);
    
  $("#font-size").on("change", onFontSizeChanged);
  onFontSizeChanged(false);

  $("#left-margin").on("change", onLeftMarginChanged);
  onLeftMarginChanged(false);

  $("#right-margin").on("change", onRightMarginChanged);
  onRightMarginChanged(false);

  $("#tight_crop").on("change", onTightCropChanged);
  onTightCropChanged(false);

  $("#alpha_threshold").on("change", onAlphaThresholdChanged);
  onAlphaThresholdChanged(false);

  $("#colour_threshold").on("change", onColourThresholdChanged);
  onColourThresholdChanged(false);

  $("#eject_px").on("change", onEjectChanged);
  onEjectChanged(false);

  $("#print").on("click", function() {
    $.post("/ajax/print", { png: $("#image_canvas")[0].toDataURL() })
    .then(res => $("#printer_status").text(res));
  });

  $("#eject").on("click", () => $.post(`/ajax/eject?px=${ejectPx}`));

  $.get("/ajax/status", setStatus);

  const socket = io();
  socket.on(PTouchStatus.UPDATE_EVENT, state => {
    setStatus(state);
    console.log("Status", state);
  });

  refreshImage();
});
