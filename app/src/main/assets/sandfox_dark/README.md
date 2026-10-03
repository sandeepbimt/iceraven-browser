# Sandfox Dark Engine v2

Replaces the failed v1 stylesheet-rewrite architecture with a pre-render Gecko WebExtension pipeline derived from UltimaDark 1.6.73.

Response filtering happens before Gecko parses content; CSS is transformed before rendering; dynamic styles and DOM APIs are handled; image-aware processing is optional; site exclusions and embedded-frame inheritance are controllable.

The engine is not declared superior until it is measured against the same real-world corpus as UltimaDark.