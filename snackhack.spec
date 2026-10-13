# PyInstaller build: pyinstaller snackhack.spec
from PyInstaller.utils.hooks import collect_data_files

datas = [("tcf/static", "tcf/static"), ("tcf/sites.json", "tcf")]
# Playwright's driver (node + package). Browsers aren't bundled: the app drives the installed Edge/Chrome.
datas += collect_data_files("playwright")

a = Analysis(["run.py"], pathex=["."], datas=datas, hiddenimports=[], excludes=["tkinter"])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="Snackhack",
          console=False, icon="tcf/static/icon.ico")
coll = COLLECT(exe, a.binaries, a.datas, name="Snackhack")
