#!/usr/bin/env python3
"""Reescreve os blocos COPY de um SQL gerado por `pg_restore --data-only -f -`
mantendo só as colunas que existem (e não são geradas) na tabela de destino.

Isso permite importar auth.users / auth.identities / storage.* do backup da
Lovable mesmo quando a versão do GoTrue/Storage da vpsfaedi tem colunas diferentes.

uso: filtrar_copy.py entrada.sql colunas.tsv saida.sql [objetos.tsv]
  colunas.tsv: linhas "schema.tabela<TAB>coluna" das colunas de destino
  objetos.tsv: (opcional) recebe "bucket_id<TAB>name" de cada storage.objects
"""
import re
import sys

entrada, colunas_tsv, saida = sys.argv[1:4]
objetos_tsv = sys.argv[4] if len(sys.argv) > 4 else None

destino = {}
for linha in open(colunas_tsv, encoding="utf-8"):
    linha = linha.rstrip("\n")
    if not linha:
        continue
    tab, col = linha.split("\t")
    destino.setdefault(tab, []).append(col)

COPY_RE = re.compile(r'^COPY\s+("?[\w]+"?)\.("?[\w]+"?)\s*\((.*)\)\s+FROM\s+stdin;\s*$')
unq = lambda s: s.strip().strip('"')

out = open(saida, "w", encoding="utf-8")
objs = open(objetos_tsv, "w", encoding="utf-8") if objetos_tsv else None
out.write("SET session_replication_role = replica;\n")

resumo = []
with open(entrada, encoding="utf-8") as f:
    linhas = iter(f)
    for linha in linhas:
        m = COPY_RE.match(linha.rstrip("\n"))
        if not m:
            continue
        tab = f"{unq(m.group(1))}.{unq(m.group(2))}"
        cols = [unq(c) for c in m.group(3).split(",")]
        alvo = destino.get(tab)
        if not alvo:
            print(f"  aviso: {tab} não existe no destino — ignorado", file=sys.stderr)
            for l in linhas:
                if l.rstrip("\n") == r"\.":
                    break
            continue
        idx = [i for i, c in enumerate(cols) if c in alvo]
        descartadas = [c for c in cols if c not in alvo]
        manter = [cols[i] for i in idx]
        out.write(f'COPY {tab} ({", ".join(chr(34) + c + chr(34) for c in manter)}) FROM stdin;\n')
        n = 0
        for l in linhas:
            l = l.rstrip("\n")
            if l == r"\.":
                break
            campos = l.split("\t")
            out.write("\t".join(campos[i] for i in idx) + "\n")
            n += 1
            if objs is not None and tab == "storage.objects":
                rec = dict(zip(cols, campos))
                objs.write(f'{rec.get("bucket_id", "")}\t{rec.get("name", "")}\n')
        out.write("\\.\n")
        resumo.append((tab, n, descartadas))

out.write("SET session_replication_role = DEFAULT;\n")
out.close()
if objs:
    objs.close()
for tab, n, desc in resumo:
    extra = f" (colunas ignoradas: {', '.join(desc)})" if desc else ""
    print(f"  {tab}: {n} linhas{extra}")
