## Added

- **Sıkıştığında bir çıkış yolu** — zemin yürümene izin vermiyorsa ve tıklamaya devam ediyorsan, oyun artık tek tıkla "Şehre dön" seçeneği sunuyor. Ücretsiz dönüş o noktalardan zaten çalışıyordu; sadece orada olduğu belli değildi.
- **Doğrudan çantandan satış** — bir tüccar açıkken çantandaki bir eşyaya Ctrl'ye basılı tutup tıklayarak satışa koy, sonra Enter ile onayla. Sürükleme eskisi gibi çalışmaya devam ediyor ve eşsiz ekipman hâlâ iki kez soruyor.

## Changed

- **Neredeyse her yerde daha çok canavar** — tüm bölgelerde canavar yoğunluğu yaklaşık %40 arttı. Öldürmeler arasında boş kalan kamplar artık dolu kalmalı.
- **Makro çemberi bir dolaşma alanı, dövüş menzili değil** — karakterin gördüğü her canavara saldırır, çemberin epey dışında olsa bile; çember yalnızca dövüşecek bir şey yokken nerede dolaşacağını belirler. Artık 150'ye kadar ayarlanabiliyor.

## Fixed

- **Kombolar imbue sonrası hasarını kaybediyordu** — bir kombonun ortasında elemental imbue'ya basmak, henüz değmemiş tüm vuruşları iptal ediyordu. Animasyon oynuyor, bekleme süresi harcanıyor, kalan vuruşlar hiçbir şey yapmıyordu. Kombolar artık imbue'lu ya da imbue'suz tamamlanıyor. Bu, Çin kombo ailelerini etkiliyordu: kılıç ve mızrak zincirleri, Soul Spear becerileri, Crosswise ve Flying Stone Smash, Devil ve Demon Cut Blade, Dragon Sore Blade ve her iki Arrow Combo.
- **Geri savrulduğun hâlde "Yere serildin" yazıyordu** — seni geriye iten bir darbe kısa süre hareketsiz bırakıyor, sonra yerde olduğunu söylüyordu. Mesaj artık geri savrulduğunu söylüyor; gerçek bir yere serilme ise hâlâ yere serildiğini söylüyor.
- **Beceri efektleri yana doğru çıkıyordu** — Wolf Bite Spear gibi koni ve kesik efektleri düşmana değil, karakterinin önündeki boşluğa doğru süpürüyordu. Artık darbenin gittiği yeri gösteriyorlar.
- **Makro sebepsiz duruyordu** — kısa bir bağlantı kesintisi yeni bir bölgeye varmış gibi görünüyor ve çalışmayı sessizce sonlandırıyordu. Kısa kesintiler artık makroyu durdurmuyor; gerçekten bölge değiştirdiğin için durduğunda ise sana söylüyor.
- **Makro peşine düşen canavarları görmezden geliyordu** — ulaşmaktan vazgeçtiği, sonra engelin etrafından dolaşıp sana vurmaya başlayan bir canavar, tam yarım dakika boyunca görmezden geliniyordu. Artık sana ulaşan her şeye karşılık veriliyor.
- **Makro başka silah isteyen buffları sessizce atlıyordu** — elinde hançer varken bir Cleric buffı, belirsiz bir satırın arkasında tüm çalışma boyunca düşürülüyordu. Artık buffın hangi silahı istediğini söylüyor ve o silahı buff listesinde becerinin üstüne koymanı istiyor.
- **Haydut görevleri yalnızca tek tür haydutu sayıyordu** — "Yolu Temiz Tut" görevi Bandit istiyordu ama kamp çoğunlukla Bandit surbodinate, Bandit Archer ve Bandit bowman'dan oluşuyor ve hiçbiri sayılmıyordu. Artık dördü de sayılıyor, yani görev verildiği seviyede tamamlanabiliyor. Constantinople günlük görevinde de aynı sorun vardı ve aynı şekilde düzeltildi.
- **Restless Stones görevi Tomb Stone Ghost'ları saymıyordu** — görevin istediği Tomb Stone'larla aynı mezarlığı paylaşıyorlar ve artık göreve sayılıyorlar.
- **Görev hedeflerini ayırt etmek kolaylaştı** — görev günlüğü artık avladığın canavarın seviyesini gösteriyor; böylece aynı kampı paylaşan benzer isimler — Tomb Stone ve Tomb Stone Ghost, Stone Ghost ve Broken Stone Ghost — artık tahmin işi değil.
- **Avrupalı karakterlerin yüzü başkasınındı** — can ve mana çubuğunun yanındaki ve grup pencerelerindeki portre, her Avrupalı görünüm için yanlış kafayı gösteriyordu. Artık her biri kendi yüzünü gösteriyor.
- **Jangan'ın arkasındaki tarlalar boştu** — şehrin kuzeyindeki Water Ghost kampı ve komşuları dünyadan tamamen çıkarılmıştı. Yaklaşık 500 canavar ait olduğu yere döndü.
- **Karakter değiştirince hayalet tezgâh** — tezgâhı açık bir karakterden çıkıp başka biriyle girmek, o karakteri hiç açmadığı bir tezgâh çalışıyormuş gibi hareket edemez ve büyü yapamaz hâlde bırakabiliyordu.
