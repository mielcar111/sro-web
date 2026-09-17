## Changed

- **Yere düşen düşmanlara vuruşlar çok daha sert** — Slash, Double Stab, Cunning Stab, Bash, Charge Swing, Triple Swing, Down Cross, Dual Counter ve Deadly Counter artık yere düşmüş düşmanlara tam yazılı bonuslarını vuruyor; hesap orijinalin yere-vuruş matematiğine çok daha yakın. Saplama, savurma ve karşı saldırı serilerinde iki bonus üst üste biner; yere düşmüş bir düşman öncekinin yaklaşık iki katı hasar alır.
- **Vuruşlar sunucu salladığı anda isabet eder** — Slash, Shield Trash, Turn Rising ve Maddening hasarı artık animasyonun temasını beklemeden, beceri ateşlendiği anda işlenir. Dövüşler daha akıcı, kesimler daha hızlı.
- **Physical ve Magical Fence müttefiklerini korur** — Fence'in müttefikinden aldığı hasar artık büyüyü yapan Savaşçıya, yani sana aktarılır; aktarılan miktarlar orijinalin hesabını izler. Müttefikin ateş altındayken kendi canına dikkat et.
- **Pain Quota acıyı orijinalin sayılarıyla böler** — kademenin payını sen üstlenirsin, kalanı menzildeki grup üyeleri arasında eşit bölünür; bölünen miktarlar ve paylaşım menzili orijinalin hesabını izler.
- **Howling Shout bütün sürüyü kışkırtır** — nara artık çevrendeki en fazla beş canavara ulaşır; önceden bir sürünün ortasında dururken erişiminin bir kısmı boşa gidebiliyordu.
- **Savaşçı sersemletmeleri seviye farkını sayar** — Sprint Assault, Axis Quiver, Double Twist ve Sudden Twist, senden çok yüksek seviyeli düşmanlara karşı artık daha az güvenilir ve daha kısa sürüyor; model orijinalin seviye farkı kuralından alındı. Kendi seviyene yakın düşmanlara karşı değişiklik yok.
- **Vital Increase'in takası yeniden hesaplandı** — hasar cezası artık diğer etkilerle toplanmak yerine çarpılır.
- **Zayıf vuruşlar sabit tabana çakılmak yerine yeniden zar atar** — zırh sonrası çok düşük kalan bir vuruş artık sabit bir alt sınıra sabitlenmez; orijinalin kurtarma kuralından modellenen düşük hasar bandına yeniden zar atılır, böylece en küçük vuruşlar çeşitlenir.

## Fixed

- **Silah değişiminde büyüler artık asılı kalmaz** — grup üyelerine atılmış Physical Fence, Magical Fence, Pain Quota ve Protect, büyüyü yapan Savaşçı kılıç, iki elli kılıç veya çift baltadan başka bir şeye geçtiği anda biter. Warcry, iki elli kılıç kuşanılı kalmadıkça doğru şekilde sona erer.
- **Bağlar sahibiyle birlikte biter** — Fence, Pain Quota veya Protect atan Savaşçı ölürse grup üyelerindeki bağlı büyüler anında biter; oyundan çıkarsa kısa bir an içinde sona erer. Her iki durumda da hiçbir büyü sahipsiz asılı kalmaz.
- **Çalınan bağlantı yuvaları** — başka bir Savaşçı senin müttefikindeki Fence'ini değiştirdiyse, eski büyücünün bağlantı yuvası artık tıkalı kalmak yerine düzgünce boşalır.
- **Aktarılan hasar temiz görünür** — Fence'in sana yönlendirdiği veya Pain Quota'nın paylaştırdığı hasar artık hayalet bir saldırı animasyonu oynatmadan hasar sayısı olarak görünür.
