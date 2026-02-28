#!/usr/bin/env python3
"""Seed a LysKOM server with test data from a JSON fixture file.

Uses httpkom's test client internally, reusing a single session for all operations.

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
      "author": "Test User",
      "subject": "Hello",
      "body": "First post",
      "content_type": "text/x-kom-basic",
      "recipient_list": [{ "type": "to", "recpt": { "conf_name": "Test Conference" }}]
    }
  ]
}

Names are resolved to numbers automatically. "author" in texts determines
which person to login as before creating that text (re-login only happens
when the author changes).
"""

import argparse
import asyncio
import json
import sys

from httpkom import app, init_app, HTTPKOM_CONNECTION_HEADER

SERVER_ID = "seed"


def configure_app(host, port):
    init_app(app)
    app.config["HTTPKOM_LYSKOM_SERVERS"] = [
        (SERVER_ID, "seed", host, port),
    ]


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


def resolve_comment_to(comment_to_list, texts_by_subject):
    """Resolve text references by subject if needed."""
    if not comment_to_list:
        return comment_to_list
    resolved = []
    for c in comment_to_list:
        entry = dict(c)
        if "subject" in entry:
            subject = entry.pop("subject")
            if subject not in texts_by_subject:
                print(f"Unknown text subject: {subject!r}", file=sys.stderr)
                sys.exit(1)
            entry["text_no"] = texts_by_subject[subject]
        resolved.append(entry)
    return resolved


async def api_request(client, method, path, headers, json_data=None, query_string=None):
    """Make a request and return (status_code, json_response)."""
    client_method = getattr(client, method.lower())
    if method in ("GET", "DELETE"):
        resp = await client_method(path, query_string=query_string, headers=headers)
    else:
        resp = await client_method(path, json=json_data or {}, headers=headers)
    resp_json = await resp.get_json()
    return resp.status_code, resp_json


async def create_session(client):
    """Create a new httpkom session, return connection_id."""
    status, data = await api_request(
        client, "POST", f"/{SERVER_ID}/sessions/",
        headers={},
        json_data={"client": {"name": "httpkom-seed", "version": "0.1"}},
    )
    if status != 201:
        print(f"Failed to create session: {data}", file=sys.stderr)
        sys.exit(1)
    return data["connection_id"]


async def login(client, headers, pers_name, passwd):
    """Login with the given credentials."""
    status, data = await api_request(
        client, "POST", f"/{SERVER_ID}/sessions/current/login",
        headers=headers,
        json_data={"pers_name": pers_name, "passwd": passwd},
    )
    if status != 201:
        print(f"Failed to login as {pers_name!r}: {data}", file=sys.stderr)
        sys.exit(1)
    return data


async def logout(client, headers):
    """Logout the current session."""
    await api_request(
        client, "POST", f"/{SERVER_ID}/sessions/current/logout",
        headers=headers,
    )


async def seed(fixture_path, host, port):
    configure_app(host, port)

    with open(fixture_path) as f:
        fixture = json.load(f)

    persons = {}       # name -> pers_no
    conferences = {}   # name -> conf_no
    texts_by_subject = {}  # subject -> text_no

    async with app.test_client() as client:
        conn_id = await create_session(client)
        headers = {HTTPKOM_CONNECTION_HEADER: conn_id}
        current_login = None

        # 1. Create persons (no login required)
        for p in fixture.get("persons", []):
            status, data = await api_request(
                client, "POST", f"/{SERVER_ID}/persons/",
                headers=headers,
                json_data={"name": p["name"], "passwd": p["passwd"]},
            )
            if status != 201:
                print(f"Failed to create person {p['name']!r}: {data}", file=sys.stderr)
                sys.exit(1)
            persons[p["name"]] = data["pers_no"]
            print(f"Created person {p['name']!r} (pers_no={data['pers_no']})")

        # 2. Login
        login_info = fixture.get("login")
        if login_info:
            await login(client, headers, login_info["pers_name"], login_info["passwd"])
            current_login = login_info["pers_name"]
            print(f"Logged in as {current_login!r}")

        # 3. Create conferences
        for c in fixture.get("conferences", []):
            status, data = await api_request(
                client, "POST", f"/{SERVER_ID}/conferences/",
                headers=headers,
                json_data={"name": c["name"]},
            )
            if status != 201:
                print(f"Failed to create conference {c['name']!r}: {data}", file=sys.stderr)
                sys.exit(1)
            conferences[c["name"]] = data["conf_no"]
            print(f"Created conference {c['name']!r} (conf_no={data['conf_no']})")

        # 4. Add memberships
        for m in fixture.get("memberships", []):
            pers_no = persons[m["pers_name"]]
            conf_no = conferences[m["conf_name"]]
            priority = m.get("priority", 100)
            where = m.get("where", 0)
            status, data = await api_request(
                client, "PUT",
                f"/{SERVER_ID}/persons/{pers_no}/memberships/{conf_no}",
                headers=headers,
                json_data={"priority": priority, "where": where},
            )
            if status >= 400:
                print(f"Failed to add membership {m['pers_name']!r} -> {m['conf_name']!r}: {data}",
                      file=sys.stderr)
                sys.exit(1)
            print(f"Added {m['pers_name']!r} to {m['conf_name']!r}")

        # 5. Create texts
        for t in fixture.get("texts", []):
            # Switch login if author differs
            author = t.get("author")
            if author and author != current_login:
                if current_login:
                    await logout(client, headers)
                person = next(p for p in fixture["persons"] if p["name"] == author)
                await login(client, headers, author, person["passwd"])
                current_login = author
                print(f"Switched to {author!r}")

            recipient_list = resolve_recipients(
                t.get("recipient_list", []), conferences)
            comment_to_list = resolve_comment_to(
                t.get("comment_to_list"), texts_by_subject)

            text_data = {
                "subject": t["subject"],
                "body": t["body"],
                "content_type": t.get("content_type", "text/x-kom-basic"),
                "recipient_list": recipient_list,
            }
            if comment_to_list:
                text_data["comment_to_list"] = comment_to_list

            status, data = await api_request(
                client, "POST", f"/{SERVER_ID}/texts/",
                headers=headers,
                json_data=text_data,
            )
            if status != 201:
                print(f"Failed to create text {t['subject']!r}: {data}", file=sys.stderr)
                sys.exit(1)
            texts_by_subject[t["subject"]] = data["text_no"]
            print(f"Created text {t['subject']!r} (text_no={data['text_no']})")

    print("\nDone!")


def main():
    parser = argparse.ArgumentParser(description="Seed LysKOM server with test data")
    parser.add_argument("fixture", help="JSON fixture file")
    parser.add_argument("--host", default="localhost", help="LysKOM server host")
    parser.add_argument("--port", type=int, default=4894, help="LysKOM server port")
    args = parser.parse_args()
    asyncio.run(seed(args.fixture, args.host, args.port))


if __name__ == "__main__":
    main()
