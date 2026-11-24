#!/usr/bin/env python3
"""Envia um backup para a pasta do Google Drive e aplica a retenção lá.

uso: drive_backup.py ARQUIVO PREFIXOS
  ARQUIVO   caminho do .tar.enc
  PREFIXOS  ex.: "diario" ou "diario,semanal,mensal" (uma cópia por prefixo: diario-<nome>, ...)
variáveis: DRIVE_TOKEN, DRIVE_PASTA, MANTER_DIARIO, MANTER_SEMANAL, MANTER_MENSAL
imprime o id do arquivo "diario" enviado.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

TOKEN = os.environ["DRIVE_TOKEN"]
PASTA = os.environ["DRIVE_PASTA"]
MANTER = {
    "diario": int(os.environ.get("MANTER_DIARIO", "7")),
    "semanal": int(os.environ.get("MANTER_SEMANAL", "4")),
    "mensal": int(os.environ.get("MANTER_MENSAL", "3")),
}
H = {"Authorization": f"Bearer {TOKEN}"}


def req(url, data=None, headers=None, method=None):
    r = urllib.request.Request(url, data=data, headers={**H, **(headers or {})}, method=method)
    return urllib.request.urlopen(r, timeout=600)


def enviar(caminho, nome):
    meta = json.dumps({"name": nome, "parents": [PASTA]}).encode()
    tamanho = os.path.getsize(caminho)
    r = req(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
        meta,
        {
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": "application/octet-stream",
            "X-Upload-Content-Length": str(tamanho),
        },
        "POST",
    )
    destino = r.headers["Location"]
    with open(caminho, "rb") as f:
        r = req(destino, f, {"Content-Type": "application/octet-stream", "Content-Length": str(tamanho)}, "PUT")
        return json.load(r)["id"]


def listar(prefixo):
    q = f"'{PASTA}' in parents and trashed = false and name contains '{prefixo}-'"
    url = "https://www.googleapis.com/drive/v3/files?" + urllib.parse.urlencode(
        {"q": q, "fields": "files(id,name,createdTime)", "orderBy": "createdTime desc", "pageSize": 200}
    )
    return [f for f in json.load(req(url))["files"] if f["name"].startswith(prefixo + "-")]


def main():
    caminho, prefixos = sys.argv[1], [p for p in sys.argv[2].split(",") if p]
    base = os.path.basename(caminho)
    id_diario = ""
    for p in prefixos:
        fid = enviar(caminho, f"{p}-{base}")
        if p == "diario":
            id_diario = fid
    for p, manter in MANTER.items():
        for f in listar(p)[manter:]:
            req(f"https://www.googleapis.com/drive/v3/files/{f['id']}", method="DELETE")
    print(id_diario)


if __name__ == "__main__":
    main()
