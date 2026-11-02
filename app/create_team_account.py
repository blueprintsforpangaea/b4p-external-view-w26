"""Make a Blueprints team account (role "hq"), or make an existing account a team account.

    python -m app.create_team_account name@b4pglobal.org "Blueprints for Pangaea"

It asks for the password twice (nothing is shown as you type). The account goes where the website
keeps accounts: the database when DATABASE_URL is set (in the environment or .env), otherwise
this computer's local test file. Team accounts can see every request and make reset links.
"""
import getpass
import os
import sys

from dotenv import load_dotenv


def main(argv: list[str]) -> int:
    if len(argv) not in (1, 2):
        print(__doc__.strip())
        return 2
    if not os.environ.get("VERCEL"):
        load_dotenv()
    from app import accounts, auth  # after .env, so DATABASE_URL is seen

    email = argv[0].strip()
    org = (argv[1] if len(argv) == 2 else "Blueprints for Pangaea").strip()
    try:
        store = accounts.store()
    except accounts.Unavailable as exc:
        print(f"Accounts aren't available here: {exc}.")
        return 1
    where = "the database" if os.environ.get("DATABASE_URL", "").strip() else f"the local test file ({accounts.local_path()})"

    if store.login_row(email):
        store.set_role(email, "hq")
        print(f"{email} already had an account. It is now a Blueprints team account, in {where}.")
        return 0

    password = getpass.getpass(f"Password for {email} (at least {auth.MIN_PASSWORD} characters): ")
    if not auth.MIN_PASSWORD <= len(password) <= auth.MAX_PASSWORD:
        print(f"The password must be {auth.MIN_PASSWORD} to {auth.MAX_PASSWORD} characters.")
        return 1
    if getpass.getpass("Type it again: ") != password:
        print("The two passwords don't match. Nothing was changed.")
        return 1
    if store.create_account(email, org, auth.hash_password(password)) is None:
        print("That email already has an account. Nothing was changed.")
        return 1
    store.set_role(email, "hq")
    print(f"Made the Blueprints team account {email}, in {where}. Sign in on the website's team page.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
