# Using an application plugin

A plugin connects Mockshop's generic scripting/rendering engine to one application's frontend, fixtures and supported behavior. Use the selected plugin's contract; do not transfer another application's routes, selectors, state controls or API shapes.

## Discover and select

```sh
./mockshop plugins
```

Plugins normally live under `plugins/<name>/`. Additional plugin roots can be supplied through `MOCKSHOP_PLUGIN_PATH` (colon-separated). Use the discovered plugin's location rather than assuming every plugin is in this checkout.

Declare `plugin: <name>` in external scripts. `--plugin <name>` selects a plugin explicitly; `MOCKSHOP_PLUGIN` changes the default. Named targets such as `<name>/<script>` select a maintained script in that plugin; a file path runs an independently authored script. Keep new demos wherever the assignment requests, including scratch space.

## Read its contract

1. Read its README and `plugin.yaml`: frontend pin, build/start requirements, editions, ports, fixture locations and runner settings.
2. Read available capability/operating references, commonly `vocabulary.yaml`, `PLAYBOOK.md` and `API-MAP.md`. Those filenames are conventions, not mandatory plugin interfaces. Follow only the guides for the requested features.
3. Read its world/app schema and adapter documentation if present. Establish which shared entities, `apps.<name>` fields and high-level operations it supports. If it has no content adapter, use its documented fixture and ordinary step path; do not invent entity mappings.
4. For each feature, identify the native screen/control, prerequisite data, operation, visible result, persistence/reset boundary and simulation limits. A rendered button is not evidence its operation is implemented.

For Onyx specifically: [README](../../../plugins/onyx/README.md), [manifest](../../../plugins/onyx/plugin.yaml), [playbook](../../../plugins/onyx/PLAYBOOK.md), [API map](../../../plugins/onyx/API-MAP.md), [app schema](../../../plugins/onyx/world.schema.json). Other plugins supply their own contracts.

## Keep reusable content separate from native behavior

World collections are optional. A plugin need not implement chat, documents, citations, models or every shared entity. Keep reusable identities/content in the world and native settings/seed DTOs in `apps.<name>`. Other app blocks may coexist without becoming requirements for this plugin. Unsupported background data may remain unused; unsupported explicitly requested behavior must be disclosed, not silently substituted.

UI instructions remain application-specific. Sharing a world across plugins does not make their scripts interchangeable. Presentation profiles are independent of both.

## Invoke only the assigned stages

Replace `PLUGIN` and the file path below with the selected plugin and authored script:

```sh
./mockshop --plugin PLUGIN validate path/to/demo.yaml
# When runtime preparation or rendering is assigned:
./mockshop build PLUGIN
./mockshop up PLUGIN
./mockshop --plugin PLUGIN shot path/to/demo.yaml
./mockshop --plugin PLUGIN clip path/to/demo.yaml
./mockshop down PLUGIN
```

Use the plugin's documented edition/build options; a fixture cannot enable code absent from the built frontend. Reuse an appropriate existing runtime rather than rebuilding unnecessarily. Check documented ports before starting/stopping; backend state is process-wide and `down` stops listeners on the configured ports. Independent concurrent runs need separate instances/ports.

Script-only work does not require builds, server startup or rendering. Report authored, compile-valid and render-verified status accurately. Unknown selectors or native prerequisites are concrete handoff uncertainties, not invented success claims.
