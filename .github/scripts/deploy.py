import paramiko
import os
import sys

EXCLUDE = {'.git', '.github', '.vscode'}
REMOTE_BASE = '/home/elkhjobe/public_html'
KEY_PATH = os.path.expanduser('~/.ssh/id_rsa')
HOST = os.environ['SSH_HOST']
USER = os.environ['SSH_USER']


def upload_dir(sftp, local_dir, remote_dir):
    try:
        sftp.stat(remote_dir)
    except FileNotFoundError:
        sftp.mkdir(remote_dir)
    for item in sorted(os.listdir(local_dir)):
        if item in EXCLUDE:
            continue
        lp = os.path.join(local_dir, item)
        rp = f"{remote_dir}/{item}"
        if os.path.isdir(lp):
            upload_dir(sftp, lp, rp)
        else:
            print(f"  -> {rp}", flush=True)
            sftp.put(lp, rp)


key = paramiko.RSAKey.from_private_key_file(KEY_PATH)
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=21098, username=USER, pkey=key, timeout=30)
sftp = client.open_sftp()

print(f"Connected to {HOST}. Uploading to {REMOTE_BASE} ...")
upload_dir(sftp, '.', REMOTE_BASE)

sftp.close()
client.close()
print("Deployment complete!")
