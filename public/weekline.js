(function () {
  var script = document.currentScript;
  if (!script || !script.src) return;
  var origin = new URL(script.src).origin;
  var frame = document.createElement("iframe");
  frame.src = origin + "/embed";
  frame.title = "Schedule an appointment";
  frame.style.cssText = "width:100%;max-width:1080px;border:0;display:block;min-height:720px;background:transparent;";
  script.insertAdjacentElement("afterend", frame);
  window.addEventListener("message", function (event) {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (!data || data.source !== "weekline") return;
    var height = Number(data.height);
    if (height > 320 && height < 8000) frame.style.height = Math.ceil(height) + "px";
  });
})();
