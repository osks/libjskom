#!/usr/bin/env python3
"""Seed a LysKOM server with test data from a JSON fixture file.

Drives httpkom-cli for all operations.

Usage:
    seed.py [--host HOST] [--port PORT] fixture.json

Fixture format:
{
  "persons": [
    { "name": "Test User", "passwd": "test123" }
  ],
  "login": { "pers_name": "Test User", "passwd": "test123" },
  "conferences": [
    { "name": "Test Conference" }
  ],
  "memberships": [
    { "pers_name": "Test User", "conf_name": "Test Conference", "priority": 100 }
  ],
  "texts": [
    {
      "id": "welcome",
      "author": "Test User",
      "subject": "Hello",
      "body": "First post",
      "content_type": "text/x-kom-basic",
      "recipient_list": [{ "type": "to", "recpt": { "conf_name": "Test Conference" }}]
    },
    {
      "author": "Test User",
      "subject": "Reply",
      "body": "A comment",
      "content_type": "text/x-kom-basic",
      "recipient_list": [{ "type": "to", "recpt": { "conf_name": "Test Conference" }}],
      "comment_to_list": [{ "type": "comment", "id": "welcome" }]
    }
  ]
}

Names are resolved to numbers automatically. "author" in texts determines
which person to login as before creating that text.

Texts can have an optional "id" field for referencing in comment_to_list.
If no "id" is given, the subject is used as fallback (must be unique).
"""

import argparse
import json
import subprocess
import sys


def cli(host, port, endpoint, params=None, data=None, pers_name=None, passwd=None):
    """Call httpkom-cli and return parsed JSON output."""
    cmd = [
        "httpkom-cli",
        "--host", host, "--port", str(port),
    ]
    if pers_name and passwd:
        cmd += ["--pers-name", pers_name, "--passwd", passwd]
    cmd.append(endpoint)
    if params:
        cmd.extend(f"{k}={v}" for k, v in params.items())

    input_data = None
    if data is not None:
        cmd += ["--data-file", "-"]
        input_data = json.dumps(data)

    result = subprocess.run(cmd, input=input_data, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Failed: {endpoint} {params or ''}", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)

    if result.stdout.strip():
        return json.loads(result.stdout)
    return None


def resolve_recipients(recipient_list, conferences):
    """Replace conf_name with conf_no in recipient list."""
    resolved = []
    for r in recipient_list:
        recpt = dict(r["recpt"])
        if "conf_name" in recpt:
            name = recpt.pop("conf_name")
            if name not in conferences:
                print(f"Unknown conference: {name!r}", file=sys.stderr)
                sys.exit(1)
            recpt["conf_no"] = conferences[name]
        resolved.append({"type": r["type"], "recpt": recpt})
    return resolved


def resolve_comment_to(comment_to_list, texts_by_id):
    """Resolve text references by id (or subject as fallback)."""
    if not comment_to_list:
        return []
    resolved = []
    for c in comment_to_list:
        entry = dict(c)
        ref = entry.pop("id", None) or entry.pop("subject", None)
        if ref:
            if ref not in texts_by_id:
                print(f"Unknown text reference: {ref!r}", file=sys.stderr)
                sys.exit(1)
            entry["text_no"] = texts_by_id[ref]
        resolved.append(entry)
    return resolved


def seed(args):
    host, port = args.host, str(args.port)

    with open(args.fixture) as f:
        fixture = json.load(f)

    persons = {}       # name -> pers_no
    conferences = {}   # name -> conf_no
    texts_by_id = {}   # id (or subject) -> text_no

    login_info = fixture.get("login", {})
    login_name = login_info.get("pers_name")
    login_passwd = login_info.get("passwd")

    # 1. Create persons (no login required)
    for p in fixture.get("persons", []):
        data = cli(host, port, "person-create",
                   data={"name": p["name"], "passwd": p["passwd"]})
        persons[p["name"]] = data["pers_no"]
        print(f"Created person {p['name']!r} (pers_no={data['pers_no']})")

    # 2. Create conferences
    for c in fixture.get("conferences", []):
        data = cli(host, port, "conference-create",
                   data={"name": c["name"]},
                   pers_name=login_name, passwd=login_passwd)
        conferences[c["name"]] = data["conf_no"]
        print(f"Created conference {c['name']!r} (conf_no={data['conf_no']})")

    # 3. Add memberships
    for m in fixture.get("memberships", []):
        pers_no = persons[m["pers_name"]]
        conf_no = conferences[m["conf_name"]]
        cli(host, port, "membership-add",
            params={"pers_no": pers_no, "conf_no": conf_no},
            data={"priority": m.get("priority", 100), "where": m.get("where", 0)},
            pers_name=login_name, passwd=login_passwd)
        print(f"Added {m['pers_name']!r} to {m['conf_name']!r}")

    # 4. Create texts
    for t in fixture.get("texts", []):
        author = t.get("author", login_name)
        person = next(p for p in fixture["persons"] if p["name"] == author)

        recipient_list = resolve_recipients(
            t.get("recipient_list", []), conferences)
        comment_to_list = resolve_comment_to(
            t.get("comment_to_list"), texts_by_id)

        text_data = {
            "subject": t["subject"],
            "body": t["body"],
            "content_type": t.get("content_type", "text/x-kom-basic"),
            "recipient_list": recipient_list,
        }
        if comment_to_list:
            text_data["comment_to_list"] = comment_to_list

        data = cli(host, port, "text-create",
                   data=text_data,
                   pers_name=author, passwd=person["passwd"])

        text_id = t.get("id", t["subject"])
        texts_by_id[text_id] = data["text_no"]
        print(f"Created text {t['subject']!r} (text_no={data['text_no']})")

    print("\nDone!")


def main():
    parser = argparse.ArgumentParser(description="Seed LysKOM server with test data")
    parser.add_argument("fixture", help="JSON fixture file")
    parser.add_argument("--host", default="localhost", help="LysKOM server host")
    parser.add_argument("--port", type=int, default=4894, help="LysKOM server port")
    args = parser.parse_args()
    seed(args)


if __name__ == "__main__":
    main()
