# Page Templates & Patterns

Use these patterns as building blocks. Only choose one template style unless the user asks for variety; prefer consistency across a single page.

## Common Landing Page Structure
```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{PAGE_TITLE}}</title>
  <style>
    /* Reset base, fonts, variables */
    /* Hero section, CTA, features, footer */
  </style>
</head>
<body>
  <!-- Nav -->
  <!-- Hero -->
  <!-- Section: Features / Why -->
  <!-- Section: CTA -->
  <!-- Footer -->
</body>
</html>
```

## Simple Service Card Page
```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{PAGE_TITLE}}</title>
</head>
<body>
  <!-- Header with logo -->
  <main class="container">
    <section class="card">
      <h1>{{MAIN_HEADING}}</h1>
      <p>{{BODY}}</p>
      <a href="{{LINK}}" class="btn">Leer más</a>
    </section>
  </main>
  <!-- Footer -->
</body>
</html>
```

## Accessibility Quick Rules
- Add `lang` attribute on `<html>`.
- Ensure every button has `aria-label` when text would be too small or redundant.
- Avoid relying solely on color to convey information.
- Images need `alt` attributes (empty alt for decorative, descriptive alt otherwise).
- Maintain logical heading order (h1 → h2 → h3); do not skip levels.
