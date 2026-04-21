"""
Mirror-deploy `dist/` (Astro build output) to Namecheap public_html via SFTP.

Strategy:
  1. Walk local dist/, upload every file (overwrite if exists).
  2. Walk remote public_html/, delete any file/dir not present locally.
  3. Skip items in PRESERVE_AT_ROOT (cPanel / LE / user-managed configs).

This guarantees the remote tree exactly matches the build output — no orphan
legacy files linger (index.html, style.css, script.js from pre-Astro era).
"""
import os
import stat
import sys
import paramiko

LOCAL_DIST = 'dist'
REMOTE_BASE = '/home/elkhjobe/public_html'
KEY_PATH = os.path.expanduser('~/.ssh/id_rsa')

# Never touched on the remote. cPanel + Let's Encrypt + user's own .htaccess.
PRESERVE_AT_ROOT = {'cgi-bin', '.well-known'}
# .htaccess is preserved only if there isn't a local one to replace it with.

HOST = os.environ['SSH_HOST']
USER = os.environ['SSH_USER']


def sftp_exists(sftp, path):
    try:
        sftp.stat(path)
        return True
    except FileNotFoundError:
        return False


def ensure_remote_dir(sftp, path):
    if not sftp_exists(sftp, path):
        sftp.mkdir(path)


def upload_tree(sftp, local_dir, remote_dir):
    """Upload every file under local_dir to remote_dir, creating dirs as needed."""
    ensure_remote_dir(sftp, remote_dir)
    for item in sorted(os.listdir(local_dir)):
        lp = os.path.join(local_dir, item)
        rp = f"{remote_dir}/{item}"
        if os.path.isdir(lp):
            upload_tree(sftp, lp, rp)
        else:
            print(f"  up  {rp}", flush=True)
            sftp.put(lp, rp)


def collect_local_paths(local_dir, base_remote):
    """Return set of remote paths (files and dirs) that SHOULD exist after upload."""
    keep = {base_remote}
    for root, dirs, files in os.walk(local_dir):
        rel = os.path.relpath(root, local_dir).replace(os.sep, '/')
        prefix = base_remote if rel == '.' else f"{base_remote}/{rel}"
        for d in dirs:
            keep.add(f"{prefix}/{d}")
        for f in files:
            keep.add(f"{prefix}/{f}")
    return keep


def prune_remote(sftp, remote_dir, keep, preserve_roots):
    """Walk remote tree, delete anything not in `keep`. Skip preserved roots."""
    for entry in sftp.listdir_attr(remote_dir):
        name = entry.filename
        path = f"{remote_dir}/{name}"
        # Only apply preserve-list at the immediate base level
        if remote_dir == REMOTE_BASE and name in preserve_roots:
            print(f"  keep {path}  (preserved)", flush=True)
            continue
        is_dir = stat.S_ISDIR(entry.st_mode)
        if is_dir:
            # Recurse first to empty it, then decide on this dir itself
            prune_remote(sftp, path, keep, preserve_roots)
            if path not in keep:
                try:
                    sftp.rmdir(path)
                    print(f"  rm  {path}/", flush=True)
                except IOError as e:
                    print(f"  !!  could not remove dir {path}: {e}", flush=True)
        else:
            if path not in keep:
                sftp.remove(path)
                print(f"  rm  {path}", flush=True)


def main():
    if not os.path.isdir(LOCAL_DIST):
        print(f"ERROR: {LOCAL_DIST}/ not found. Did `npm run build` run?", file=sys.stderr)
        sys.exit(1)

    key = paramiko.RSAKey.from_private_key_file(KEY_PATH)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=21098, username=USER, pkey=key, timeout=30)
    sftp = client.open_sftp()

    # Decide whether to preserve server-side .htaccess
    preserve = set(PRESERVE_AT_ROOT)
    local_htaccess = os.path.join(LOCAL_DIST, '.htaccess')
    if not os.path.exists(local_htaccess):
        preserve.add('.htaccess')

    print(f"Connected to {HOST}. Mirroring {LOCAL_DIST}/ -> {REMOTE_BASE}")
    print(f"Preserved at root: {sorted(preserve)}")

    # 1. Upload everything
    upload_tree(sftp, LOCAL_DIST, REMOTE_BASE)

    # 2. Prune orphans
    keep = collect_local_paths(LOCAL_DIST, REMOTE_BASE)
    prune_remote(sftp, REMOTE_BASE, keep, preserve)

    sftp.close()
    client.close()
    print("Deployment complete.")


if __name__ == '__main__':
    main()
