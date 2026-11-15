---
name: Web Page Creator
description: Create complete HTML pages with responsive design, semantic structure, and accessible markup
metadata:
  opencode/autoinvoke: false
---

## Workflow

1. Determine the page purpose and target audience from the user prompt.
2. Use `references/page-templates.md` for reusable patterns when suitable; only fall back to hand-writing from scratch for uncommon layouts.
3. Write all markup in this order: DOCTYPE + `<html>`, `<head>` (meta viewport, title, link/inline CSS), `<body>`, then CSS before closing tags if inline.
4. Validate responsiveness by checking the viewport meta tag and using fluid units (`%`, `vw`, `rem`) over fixed pixels where practical.
5. Verify accessibility basics: ARIA labels on icon buttons, color contrast ratio ≥ 4.5:1, and focus management order.
6. Review the final file for incomplete tags, unclosed attributes, and proper indentation (2 spaces per level).
7. Save the file using the suggested relative path; never overwrite existing files without asking.
