from tcf.store import _migrate


def test_migrate_moves_old_data_folder(tmp_path):
    old, new = tmp_path / "5kateit", tmp_path / "Snackhack"
    old.mkdir()
    (old / "codes.json").write_text("[]")
    _migrate([old], new)
    assert (new / "codes.json").exists() and not old.exists()


def test_migrate_leaves_existing_new_folder_alone(tmp_path):
    old, new = tmp_path / "5kateit", tmp_path / "Snackhack"
    old.mkdir(); new.mkdir()
    (new / "codes.json").write_text("[1]")
    _migrate([old], new)
    assert old.exists() and (new / "codes.json").read_text() == "[1]"
