## Added

- **Rechtsklick zum Einlagern** — bei geöffnetem Lager oder Gildenlager legst du einen Gegenstand aus deiner Tasche per Rechtsklick hinein. Herausnehmen ging schon immer so; Hineinlegen war nur per Ziehen möglich, und ein Rechtsklick auf einen Trank beim Lagerverwalter hat ihn stattdessen getrunken. Solange ein Lager offen ist, gewinnt jetzt das Einlagern.
- **Eine Warnung, wenn die 3D-Ansicht ausfällt** — wenn deine Grafikkarte das Spiel fallen lässt, wurde die Welt einfach schwarz, während alles andere weiterlief; du konntest in einen Kampf laufen, den du nicht sehen konntest. Jetzt bekommst du eine klare Meldung und einen Knopf zum Neuladen, und die Auto-Jagd stoppt sich selbst, statt blind weiterzukämpfen.

## Changed

- **Gruppen-Gegenstandsteilung teilt wirklich** — Gegenstände gehen beim Aufheben reihum an das nächste Mitglied, und alle in Reichweite erfahren, wer was bekommen hat. Vorher behielt schlicht der Schnellste alles, die Einstellung tat also gar nichts. Schalte die Teilung ab, wenn jeder für sich sammeln soll.
- **Auto-Jagd läuft auch im Hintergrund-Tab weiter** — ein Tab-Wechsel hat sie bisher komplett gestoppt: dein Charakter stand still, trank keine Tränke mehr und starb meistens. Sie jagt und heilt jetzt auch weiter, während der Tab im Hintergrund ist.

## Fixed

- **Kombos verloren ihren Schaden, sobald du die nächste Fähigkeit gedrückt hast** — eine Kombo zu starten und sofort eine andere Fähigkeit zu drücken hat alle noch ausstehenden Treffer abgebrochen, sodass Soul Spear - Emperor nur einen statt zwei Treffer machte. Die nächste Fähigkeit wartet jetzt, bis sie an der Reihe ist, und die Kombo läuft vollständig durch. Das betrifft alle Kombo-Familien: die Schwert- und Speerketten, die Soul Spears, Crosswise und Flying Stone Smash, Devil und Demon Cut Blade, Dragon Sore Blade und beide Arrow Combos.
- **Von einem 1.000er-Stapel blieb immer einer übrig** — ein voller Stapel Holz oder Stein ins Lager oder Gildenlager zu legen bewegte 999 und ließ genau eine Einheit zurück, in beide Richtungen. Volle Stapel wandern jetzt komplett.
- **Zweihandwaffen ließen sich nicht über einen Schild anlegen** — auf einen Zweihandstab, Speer oder Bogen zu wechseln, während du Einhandwaffe und Schild trugst, tat schlicht nichts, ohne jede Erklärung. Jetzt wandern beide Teile in deine Tasche, und es scheitert nur noch, wenn deine Tasche wirklich voll ist — was dir dann auch gesagt wird.
- **Ein zweites Fenster verdeckte die Gegenstandswerte** — beim Überfahren eines Gegenstands erschienen erst die Werte und dann ein kleiner grauer Kasten mit dem Namen darüber, der die ersten Zeilen verdeckte. Dieser doppelte Kasten ist weg.
- **Schadenszahlen waren bei großen Monstern unsichtbar** — bei Yetis, Bone Lords, Kerberos und ähnlichen standen Name und Schaden bei normalem Zoom über dem oberen Bildschirmrand, du hast also nie eine Zahl gesehen. Die gesamte Beschriftung rutscht jetzt ins Bild. Normal große Monster sehen aus wie bisher.
- **Monster, die den Kampf abbrachen, nahmen still keinen Schaden** — ein Monster, das aufgibt und zu seinem Startpunkt zurückläuft, ist auf dem Weg unverwundbar, aber das Spiel sagte nichts: deine Schläge zeigten keine Animation, es erschienen keine Zahlen, und eine Fähigkeit kostete trotzdem Mana und Abklingzeit. Jetzt wird dir gesagt, dass das Monster zurückkehrt, und die Verfolgung endet.
- **Charaktere liefen in einer eingefrorenen Fähigkeitspose herum** — starb ein Monster, während eine Fähigkeit noch lud, blieb die Pose hängen und dein Charakter glitt eine Weile so über den Boden. Die Animation hält sich jetzt an das Timing der Fähigkeit und gibt den Körper wieder ans Laufen ab.
- **Auto-Jagd konnte festhängend endlos umherziehen** — ein in der Landschaft verkeilter Charakter suchte sich immer wieder ein neues Lager, ohne dass irgendetwas auf ein Problem hindeutete. Jetzt wird dieselbe Rückkehr in die Stadt per Klick angeboten wie beim Laufen von Hand.
