## Added

- **Ein Ausweg, wenn du feststeckst** — wenn der Boden dich nicht laufen lässt und du weiterklickst, bietet das Spiel jetzt mit einem Klick die Rückkehr in die Stadt an. Die kostenlose Rückkehr funktionierte an diesen Stellen immer schon; man sah nur nicht, dass es sie gibt.
- **Direkt aus der Tasche verkaufen** — halte Strg und klicke bei geöffnetem Händler auf einen Gegenstand in deinem Inventar, um ihn zum Verkauf zu stellen, und bestätige mit Enter. Ziehen funktioniert unverändert weiter, und einzigartige Ausrüstung fragt weiterhin zweimal nach.

## Changed

- **Mehr Monster, fast überall** — die Monsterdichte ist in allen Regionen um rund 40% gestiegen. Lager, die sich zwischen zwei Kills leer anfühlten, sollten jetzt belebt bleiben.
- **Der Makro-Kreis ist ein Streifgebiet, keine Kampfreichweite** — dein Charakter greift jedes Monster an, das er sieht, auch weit außerhalb des Kreises; der Kreis bestimmt nur, wo er umherläuft, solange es nichts zu kämpfen gibt. Er lässt sich jetzt bis 150 einstellen.

## Fixed

- **Kombos verloren nach einem Imbue ihren Schaden** — ein elementares Imbue mitten in einer Kombo brach alle noch ausstehenden Schläge ab. Die Animation lief, die Abklingzeit war verbraucht, und die restlichen Treffer richteten nichts aus. Kombos laufen jetzt durch, mit oder ohne Imbue. Betroffen waren die chinesischen Kombo-Familien: die Schwert- und Speerketten, die Soul Spears, Crosswise und Flying Stone Smash, Devil und Demon Cut Blade, Dragon Sore Blade und beide Arrow Combos.
- **"Du bist zu Boden geworfen", obwohl du zurückgestoßen wurdest** — ein Stoß, der dich wegschob, hielt dich kurz fest und behauptete dann, du lägest am Boden. Die Meldung sagt jetzt, dass du zurückgeschleudert wurdest; ein echter Niederschlag sagt weiterhin, dass du zu Boden gegangen bist.
- **Fertigkeitseffekte gingen zur Seite los** — Kegel- und Hiebeffekte wie Wolf Bite Spear fegten durch die Luft vor deinem Charakter statt in den Gegner. Sie zeigen jetzt dorthin, wohin der Schlag geht.
- **Das Makro stoppte ohne Grund** — ein kurzer Verbindungsaussetzer sah aus wie die Ankunft in einem neuen Gebiet und beendete den Lauf stillschweigend. Kurze Unterbrechungen stoppen es nicht mehr, und wenn es wirklich wegen eines Gebietswechsels stoppt, sagt es das jetzt.
- **Das Makro ignorierte Monster, die dir nachliefen** — ein Monster, das es aufgegeben hatte zu erreichen, das dann um das Hindernis herumlief und auf dich einschlug, blieb eine halbe Minute lang ignoriert. Alles, was dich erreicht, wird jetzt erwidert.
- **Das Makro übersprang stillschweigend Buffs, die eine andere Waffe brauchen** — ein Cleric-Buff mit einem Dolch in der Hand wurde hinter einer nichtssagenden Zeile für den ganzen Lauf verworfen. Es nennt jetzt die Waffe, die der Buff braucht, und fordert dich auf, sie in der Buff-Liste über die Fertigkeit zu setzen.
- **Banditen-Quests zählten nur eine Sorte Bandit** — "Haltet die Straße frei" verlangte Bandit, aber das Lager besteht überwiegend aus Bandit surbodinate, Bandit Archer und Bandit bowman, und keiner davon zählte. Jetzt zählen alle vier, die Quest ist also auf der Stufe abschließbar, auf der sie angeboten wird. Die Konstantinopel-Tagesquest hatte dasselbe Problem und ist genauso korrigiert.
- **Restless Stones ignorierte Tomb Stone Ghosts** — sie teilen sich den Friedhof mit den Tomb Stones, die die Quest verlangt, und zählen jetzt mit.
- **Questziele lassen sich leichter auseinanderhalten** — das Questlog zeigt jetzt die Stufe des gejagten Monsters. Namensvettern, die sich ein Lager teilen — Tomb Stone und Tomb Stone Ghost, Stone Ghost und Broken Stone Ghost — sind damit keine Ratesache mehr.
- **Europäische Charaktere hatten ein fremdes Gesicht** — das Porträt neben deiner Lebens- und Manaleiste und in den Gruppenfenstern zeigte bei jedem europäischen Aussehen den falschen Kopf. Jetzt zeigt jedes das eigene.
- **Die Felder hinter Jangan waren leer** — das Water-Ghost-Lager nördlich der Stadt und seine Nachbarn fehlten komplett in der Welt. Rund 500 Monster sind wieder dort, wo sie hingehören.
- **Ein Geister-Stand nach einem Charakterwechsel** — einen Charakter mit offenem Stand zu verlassen und sich mit einem anderen anzumelden, konnte diesen bewegungs- und zauberunfähig machen, als liefe ein Stand, den er nie geöffnet hat.
