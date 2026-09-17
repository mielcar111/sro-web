## Added

- **Sağ tıkla depoya koy** — Depo ya da Lonca Deposu açıkken çantandaki bir şeye sağ tıklayarak içeri koyabilirsin. Dışarı almak zaten böyle çalışıyordu; koymak yalnızca sürükleyerek yapılabiliyordu ve Depocu'nun yanında iksire sağ tıklamak onu içiyordu. Depo açıkken artık koyma işlemi önceliklidir.
- **3B görüntü durduğunda uyarı** — ekran kartın oyunu bıraktığında dünya öylece kararıyor, geri kalan her şey çalışmaya devam ediyordu; göremediğin bir kavganın içine yürüyebiliyordun. Artık net bir mesaj ve Yenile düğmesi görüyorsun, otomatik av da körlemesine dövüşmek yerine kendini durduruyor.

## Changed

- **Parti Eşya Paylaşımı gerçekten paylaşıyor** — eşyalar yerden alındığında sıradaki üyeye veriliyor ve menzildeki herkese kimin ne aldığı bildiriliyor. Önceden ilk tıklayan her şeyi alıyordu, yani ayarın hiçbir etkisi yoktu. Herkes kendine alsın istiyorsan Eşya Paylaşımı'nı kapat.
- **Otomatik av arka plandaki sekmede de sürüyor** — başka bir sekmeye geçmek onu tamamen durduruyordu: karakterin öylece duruyor, iksir içmiyor ve çoğu zaman ölüyordu. Artık sekme arka plandayken de avlanmaya ve iyileşmeye devam ediyor.

## Fixed

- **Bir sonraki yeteneğe basınca kombolar hasarını kaybediyordu** — komboyu başlatıp hemen başka bir yeteneğe basmak, henüz inmemiş tüm vuruşları iptal ediyordu; Soul Spear - Emperor iki yerine tek vuruş yapıyordu. Sıradaki yetenek artık sırasını bekliyor ve kombo eksiksiz tamamlanıyor. Bu tüm kombo aileleri için geçerli: kılıç ve mızrak zincirleri, Soul Spear'lar, Crosswise ve Flying Stone Smash, Devil ve Demon Cut Blade, Dragon Sore Blade ve iki Arrow Combo.
- **1.000'lik yığından hep bir tane kalıyordu** — dolu bir odun ya da taş yığınını Depo'ya veya Lonca Deposu'na taşırken 999 tanesi gidiyor, bir tanesi geride kalıyordu; çekerken de aynısı oluyordu. Dolu yığınlar artık bütün olarak taşınıyor.
- **İki elli silahlar kalkanın üstüne takılmıyordu** — tek elli bir silah ve kalkan varken iki elli asa, mızrak ya da yaya geçmek hiçbir şey yapmıyor, hiçbir açıklama da çıkmıyordu. Artık iki parça da çantana iniyor; yalnızca çantan gerçekten doluysa başarısız oluyor ve bunu söylüyor.
- **İkinci bir balon eşya bilgilerini kapatıyordu** — bir eşyanın üstüne gelince önce bilgileri çıkıyor, sonra adını gösteren küçük gri bir kutu üstüne binip ilk satırları gizliyordu. O kutu kaldırıldı.
- **Uzun canavarlarda hasar sayıları görünmüyordu** — Yeti, Bone Lord, Kerberos gibi canavarlarda hem isim hem hasarın ekranın üstünde kalıyordu, yani hiçbir sayı göremiyordun. Etiketin tamamı artık görüş alanına iniyor. Normal boyuttaki canavarlar aynen eskisi gibi.
- **Savaşı bırakan canavarlar sessizce hasar almıyordu** — vazgeçip doğduğu yere dönen bir canavar yolda hasar almaz, ama oyun bunu hiç söylemiyordu: vuruşların canlanmıyor, sayı çıkmıyor, yetenek yine de manasını ve bekleme süresini harcıyordu. Artık canavarın döndüğünü söylüyor ve peşinden koşmayı bırakıyor.
- **Karakterler yetenek pozunda donup koşuyordu** — yetenek henüz yüklenirken canavar ölürse poz takılı kalıyor ve karakterin bir süre öyle kayıyordu. Animasyon artık yeteneğin kendi zamanlamasına uyuyor ve bedeni koşuya geri veriyor.
- **Otomatik av takılıyken sonsuza dek dolaşabiliyordu** — dekora sıkışmış bir karakter sürekli yeni kamp seçip aramaya devam ediyor, bir sorun olduğuna dair hiçbir işaret vermiyordu. Artık elle yürürken çıkan tek tıkla şehre dönüş seçeneğini sunuyor.
