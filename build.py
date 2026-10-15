from pathlib import Path
import json,zipfile
root=Path(__file__).parent
src=root/'src'
files=['replacement.js','reading-surface.js','token-budget.js','extras.js','transport.js','facet.js','core.js','preset.js','renderer.js','marinara-host.js','launcher-icon.js','extras-ui.js','enhancements.js','design.js','compact.js','series.js','rp-chat.js','composer.js','reading-ui.js','excerpt.js','shell.js','marinara-ui.js','marinara-lore.js','marinara-collect.js','generation.js','extension.js']
code='const appHost=createMarinaraHost(marinara);\nconst SIDE_STYLE='+json.dumps((src/'style.css').read_text(),ensure_ascii=False)+';\n'
code+='\n'.join((src/f).read_text() for f in files)
# Full-page extensions run in Marinara's async function, with the `marinara` argument.
code=code.replace('/* SillyTavern companion extension, opened from the current chat. */','/* Marinara client entry point. */')
(root/'extension.js').write_text(code)
print('Built extension.js')
