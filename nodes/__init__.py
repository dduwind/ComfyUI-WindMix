# ComfyUI-WindMix — `nodes` package.
#
# Holds the efficiency-derived nodes (wind_efficiency_nodes.py), shared helpers
# (wind_utils.py), the `py/` subpackage (sampler/upscaler helpers), and the
# `xy/` subpackage (XY Plot). Modules inside use relative
# imports (e.g. `from .wind_utils import *`, `from ..wind_utils import *`),
# so `nodes` must be a proper package — hence this __init__.py.
