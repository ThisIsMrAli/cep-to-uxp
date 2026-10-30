# Hosts

Checked against Adobe's manifest reference and the September 2026 CEP transition post. Re-check those pages before changing `scripts/lib/hosts.mjs`. If the docs and this file disagree, trust the current host docs, then update the code and this file together.

Manifest app ids from [the UXP manifest reference](https://developer.adobe.com/uxp/guides/explanation/concepts/manifest/):

| CEP `Host Name` | UXP `host.app` | Converter floor | Notes |
| --- | --- | --- | --- |
| `PHXS`, `PHSP` | `PS` | `26.0.0` | Local WebView needs UXP 8. Photoshop 26 is the first public generation known to ship it. |
| `IDSN` | `ID` | `20.0.0` | Conservative local-WebView floor, not the first InDesign with any UXP. |
| `PPRO` | `premierepro` | `25.6.0` | Adobe's documented Premiere UXP example. Raise it if `plugin:/` fails. |
| `AME` | `ame` | `26.5.0` | Public beta. Some samples still say `mediaencoder`. Switch only if UDT rejects `ame`. |
| `ILST` | none | blocked | Public beta was announced for spring 2027. No app id yet. |
| `AEFT` | none | blocked | Public beta was announced for November 2026. No app id yet. |
| anything else | none | blocked | Leave that host on CEP. |

`host` is one object in a distributed plugin. The converter emits an array only when more than one supported host remains, and the migration report says to split it before packaging. UDT uses the first entry when it packages an array.

Floors exist so local WebView is not declared for an older host. They are not a promise about every API. Raise `minVersion` when the host docs require it.

The panel document is shared. HTML and CSS limits are listed once for Photoshop and again, in the same words, for Premiere. InDesign and Media Encoder do not publish a separate list. DOM and CSS guards in `uxp-compat.js` apply to every host. See [uxp-document.md](uxp-document.md). Host modules (`photoshop`, `indesign`, `premierepro`) stay different, and none of them run ExtendScript.

## Timeline context

From Adobe's September 2026 transition note:

- Photoshop, InDesign, and Premiere already ship UXP plugins. Media Encoder is in public beta.
- Photoshop stops taking new Marketplace CEP submissions in March 2027 and disables CEP by default in December 2027.
- Premiere stops new CEP submissions in December 2027. InDesign follows in January 2028. Both disable CEP by default in December 2028.
- CEP leaves these flagship apps in December 2029.
- ExtendScript files run from the app are a separate feature. CEP's `evalScript` bridge is not. UXP still cannot execute JSX.

Premiere hybrid plugins are available. Photoshop hybrid plugins are available. InDesign hybrid plugins were announced for summer 2027.

## Sources

- https://developer.adobe.com/uxp/guides/explanation/concepts/manifest/
- https://developer.adobe.com/uxp/migration-center/
- https://blog.developer.adobe.com/en/publish/2026/09/investing-in-the-future-of-creative-cloud-extensibility-uxp-comes-to-our-flagship-applications
