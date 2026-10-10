"""Reproducible ECDICT subset. Upstream MIT license is retained beside the database."""
import csv, io, sqlite3, urllib.request, hashlib, pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
COMMIT='bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b'
URL=f'https://raw.githubusercontent.com/skywind3000/ECDICT/{COMMIT}/ecdict.csv'
raw=urllib.request.urlopen(URL,timeout=120).read()
checksum=hashlib.sha256(raw).hexdigest()
# Frozen upstream commit; on repeat runs verify the recorded content hash.
manifest=ROOT/'assets/dictionary-provenance.txt'
if manifest.exists():
 expected=manifest.read_text().split('sha256=')[1].splitlines()[0]
 if checksum!=expected: raise RuntimeError('Dictionary checksum mismatch')
path=ROOT/'assets/dictionary.sqlite'
if path.exists(): path.unlink()
db=sqlite3.connect(path)
db.executescript('CREATE TABLE entries(word TEXT PRIMARY KEY, phonetic TEXT, definition TEXT, translation TEXT, pos TEXT, tag TEXT, bnc INTEGER, frq INTEGER, oxford INTEGER); CREATE TABLE forms(form TEXT PRIMARY KEY, word TEXT);')
count=0
for row in csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))):
 def num(k):
  try:return int(row[k] or 0)
  except:return 0
 word=row['word'].strip().lower()
 if not word or not row['translation']: continue
 if not (row['tag'] or 0<num('bnc')<=40000 or 0<num('frq')<=40000 or row['oxford']=='1'): continue
 db.execute('INSERT OR IGNORE INTO entries VALUES(?,?,?,?,?,?,?,?,?)',(word,row['phonetic'],row['definition'].replace('\\n','\n'),row['translation'].replace('\\n','\n'),row['pos'],row['tag'],num('bnc'),num('frq'),num('oxford')))
 for item in row['exchange'].split('/'):
  if ':' in item:
   key,forms=item.split(':',1)
   if key in ['p','d','i','3','r','t','s']:
    for form in forms.split(','):
     db.execute('INSERT OR IGNORE INTO forms VALUES(?,?)',(form.lower(),word))
 count+=1
db.commit();db.execute('VACUUM');db.close()
manifest.write_text(f'Source: {URL}\ncommit={COMMIT}\nsha256={checksum}\nentries={count}\nselection=exam tags or BNC/COCA rank <= 40000 or Oxford core\nlicense=MIT (upstream repository declaration)\n')
(ROOT/'licenses/ECDICT-MIT.txt').write_bytes(urllib.request.urlopen(f'https://raw.githubusercontent.com/skywind3000/ECDICT/{COMMIT}/LICENSE').read())
print('Dictionary ready:',count,'records;',path.stat().st_size,'bytes;',checksum)
