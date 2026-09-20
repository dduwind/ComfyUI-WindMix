import { app } from "/scripts/app.js";

// Collapsible "Advanced: CLIP Type" for the ⚡ DiT Efficient Loader.
// CLIP type is auto-matched per model family and hidden from the UI by default;
// expand the "高级：CLIP 类型" toggle to override it manually.
// Reuses the proven "tschide" hide mechanism from widgethider.js.

function setWidgetHidden(node, widget, hidden) {
    if (!widget) return;
    if (hidden) {
        widget.type = "tschide";
        widget.computeSize = () => [0, -4];
    } else {
        widget.type = widget._orig_type;
        widget.computeSize = widget._orig_computeSize;
    }
    node.setSize([node.size[0], node.computeSize()[1]]);
}

app.registerExtension({
    name: "windmix.eff.dit_advanced",
    nodeCreated(node) {
        if (node.comfyClass !== "⚡ DiT Efficient Loader") return;
        const toggle = node.widgets?.find(w => w.name === "show_advanced_clip");
        const clipWidget = node.widgets?.find(w => w.name === "clip_type_override");
        if (!toggle || !clipWidget) return;

        // Remember original renderer state so we can restore on expand.
        toggle._orig_type = toggle.type;
        clipWidget._orig_type = clipWidget.type;
        clipWidget._orig_computeSize = clipWidget.computeSize;

        // Relabel the boolean as the collapsible section header.
        toggle.name = "高级：CLIP 类型";

        // Default: collapsed — hide the CLIP type override dropdown.
        setWidgetHidden(node, clipWidget, !toggle.value);

        const update = () => setWidgetHidden(node, clipWidget, !toggle.value);

        // Hook the toggle's value setter so expanding/collapsing shows/hides the dropdown.
        const desc = Object.getOwnPropertyDescriptor(toggle, "value");
        const origGet = desc?.get;
        const origSet = desc?.set;
        Object.defineProperty(toggle, "value", {
            get() { return origGet ? origGet.call(toggle) : toggle._v; },
            set(v) {
                if (origSet) origSet.call(toggle, v); else toggle._v = v;
                update();
            }
        });
    }
});
