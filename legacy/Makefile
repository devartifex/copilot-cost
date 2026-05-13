.PHONY: test bundle clean

test:
	python3 -m unittest discover -s tests -v

bundle:
	mkdir -p dist
	python3 -c "from pathlib import Path; root=Path('.'); files=['pricing_loader.py','usage_db.py','pricing_fetcher.py','otel_reader.py','dashboard/server.py','cost_statusline.py']; out=['#!/usr/bin/env python3','\n# Bundled source concatenation for review/distribution.\n# Install from the repository for normal use.\n']; [out.extend([f'\n# ===== {f} =====\n',(root/f).read_text()]) for f in files]; Path('dist/cost_statusline.py').write_text('\n'.join(out))"
	chmod +x dist/cost_statusline.py

clean:
	rm -rf __pycache__ dashboard/__pycache__ tests/__pycache__ .test-home dist
