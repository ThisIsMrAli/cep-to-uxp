# Hosts and plugin types

UXP plugins for the public hosts are panels, commands, or both. The same manifest shape is used in every host. The document API is not.

| CEP host | UXP `host.app` | Host module | Document work |
| --- | --- | --- | --- |
| `PHXS`, `PHSP` | `PS` | `require("photoshop")` | `core.executeAsModal`. `batchPlay` only when the DOM has no method. |
| `IDSN` | `ID` | `require("indesign")` | Confirm names in the InDesign UXP reference. |
| `PPRO` | `premierepro` | `require("premierepro")` | Confirm names in the Premiere UXP reference. |
| `AME` | `ame` | Media Encoder UXP reference | Do not call Photoshop or Premiere modules from Media Encoder. |

`mediaencoder` appears in some sample repos. The shared manifest reference says `ame`. If the UXP Developer Tool rejects `ame`, switch that one field and record it.

Illustrator and After Effects do not have a public manifest app id yet. The converter writes a report and no plugin for those hosts.

| CEP `UI/Type` | UXP entrypoint | Why |
| --- | --- | --- |
| `Panel`, `Modeless` | `panel` | Persistent, dockable workspace. |
| `ModalDialog` | `command` | Opens a blocking dialog with `uxpShowModal()`. |
| `Custom` | `command` | No docked panel. The command can still open a dialog. |

A `.ccx` package targets one host. When the CEP manifest lists several supported apps, ask which one to ship and pass `--host`. An array in `manifest.json` is only for development.

Hybrid plugins are a third kind: C++ addons for processes, sockets, and `.node` files. Opening Finder or Explorer is `shell.openPath`, not a hybrid addon. Photoshop and Premiere ship hybrid plugins. InDesign hybrid plugins were announced for summer 2027.
