# Notices and Third-Party Attributions

This project incorporates third-party open-source software and specifications under their respective permissive licenses.

---

## 1. Improve Codebase Architecture

This plugin and skill package includes an Antigravity-adapted implementation of Matt Pocock's `improve-codebase-architecture` skill.

- **Upstream Project:** [https://github.com/mattpocock/skills](https://github.com/mattpocock/skills)
- **Original Skill Path:** `skills/engineering/improve-codebase-architecture/SKILL.md`
- **Copyright:** Copyright (c) 2026 Matt Pocock
- **License:** MIT License

### Adaptations
The skill has been adapted for Antigravity's multi-agent and subagent orchestration framework. Key safety adaptations include:
- Read-only discovery phase without mutating project files or documentation.
- Explicit human selection gate before architectural design and interface specification.
- Removal of automated external issue/pull request generation.
- Removal of unprompted architectural decision record (ADR) or glossary edits.
- Requirement for verified test evidence before marking refactor candidates complete.

### Original MIT License & Disclaimer

```text
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

