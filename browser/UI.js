/*Copyright (C) 2024 Crawford Currie http://c-dot.co.uk*/
/* eslint-env browser */

/**
 * User interface to capture HTML defintions of labels that can then
 * be sent (as images) to a label printer server.
 */

/* global domtoimage */

// Last info received from the server. This describes the printer.
let info = {
  model: "Unknown",
  pixel_width_mm: 0,
  eject_px: 0,
  eject_mm: 0,
  raster_px: 0,
  raster_mm: 0,
  printable_width_px: 0,
  printable_width_mm: 0,
  media_width_px: 0,
  media_width_mm: 0,
  phase: "Uninitialised"
};

// Thresholds for colour conversion, tunable per image
let alphaThreshold = 30;
let colourThreshold = 30;

/**
 * Get the current selection in the textarea. If start and end
 * are the same, there is no selection. The selection persists
 * when the textarea no longer has the focus, and only gets
 * cleared when it regains the focus.
 */
function getTextSelection() {
  const txtarea = $("#label_text")[0];
  return {
    start: txtarea.selectionStart,
    end: txtarea.selectionEnd
  };
}

function setInfo(n) {
  info = n;
  for (const f of Object.keys(info)) {
    $(`.text-${f}`).text(info[f]);
    $(`.min-height-${f}`).css("min-height", `${info[f]}px`);
  }
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
    const h = node.scrollHeight;
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

      // Strip empty rows from top and bottom
      const crop = trim(imageData.data, w, h);

      // Monochromise the image
      BandW(imageData.data, w, h);
      dom_ctx.putImageData(imageData, 0, 0);

      // Render the cropped image onto the canvas
      const canvas = $("#image_canvas")[0];
      $("#image_liner").width(canvas.width = w);
      $("#image_liner").height(canvas.height = crop[1]);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(dom_canvas, 0, crop[0], w, crop[1],
                    0, 0, w, crop[1]);

      $("#label_length_px").text(w);
      $("#label_length_mm").text((w * info.pixel_width_mm).toFixed(2));

      $("#label_width_px").text(h);
      $("#label_width_mm").text((h * info.pixel_width_mm).toFixed(2));

      // If multiple tape runs are required, show the bounds of the
      // first tape run
      if (h > info.printable_width_px) {
        $("#tape_div")
        .css("top", 0)
        .css("left", "0")
        .css("height", `${info.printable_width_px}px`)
        .show();
      } else
        $("#tape_div").hide();
    });
  }, 100);
}

function onLabelChanged() {
  const content = $("#label_text").val();
  $("#review_div").html(content);
  refreshImage();
}

/**
 * Set the font family for the current selection (if there is one)
 * or the whole document
 */
function setFontFamily(font) {
  const classList = $('#review_div').attr('class').split(/\s+/);
  $.each(classList, function(index, item) {
    if (item.indexOf("font-family-") === 0) {
      $("#review_div").removeClass(item);
    }
  });

  refreshImage();
}

function setFontSize(size) {
  $("#review_div").css("font-size", `${size}px`);
  refreshImage();
}

/**
 * Set the rendering alpha threshold
 */
function setAlphaThreshold(th) {
  alphaThreshold = th;
  refreshImage();
}

/**
 * Set the rendeing colour threshold
 */
function setColourThreshold(th) {
  colourThreshold = th;
  refreshImage();
}

$(function() {
  $("#label_text").on("keyup", onLabelChanged);

  $("#select_font").on("change", function() {
    setFontFamily(this.value);
  });
  setFontFamily($("#select_font").val());
    
  $("#font-size").on("change", function() {
    setFontSize(this.value);
  });
  setFontSize($("#font-size").val());

  $("#print").on("click", function() {
    $.post("/ajax/print", { png: $("#image_canvas")[0].toDataURL() })
    .then(res => {
      alert(res);
    });
  });

  $("#alpha_threshold").on("change", function() {
    setAlphaThreshold(this.value);
  });
  setAlphaThreshold($("#alpha_threshold").val());

  $("#colour_threshold").on("change", function() {
    setColourThreshold(this.value);
  });
  setColourThreshold($("#colour_threshold").val());

  $("#eject").on("click", function() {
    $.post("/ajax/eject");
  });

  $.get("/ajax/info", info => {
    console.debug("Received INFO", info);
    setInfo(info);
  });

  onLabelChanged();
});

