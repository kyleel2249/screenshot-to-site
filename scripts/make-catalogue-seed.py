"""Builds data/catalogue-seed.csv and a neutral branded placeholder image for every item in public/products/<sku>.png.
Items are generic starter names (no brands, specs, prices or stock). Replace a placeholder by dropping a real image with the same file name."""
import csv, os
from PIL import Image, ImageDraw, ImageFont

NAVY, GOLD, WHITE = (7, 29, 73), (245, 185, 0), (255, 255, 255)
ITEMS = {
 "cars--suvs": ["Family SUV (enquire for models)"], "cars--saloon-cars": ["Saloon Car (enquire for models)"],
 "household-and-kitchen--household-items": ["Laundry Basket", "Storage Container Set"], "household-and-kitchen--kitchen-items": ["Non-Stick Cooking Pot Set", "Kitchen Knife Set"],
 "household-and-kitchen--other-household-products": ["Table Lamp"],
 "clothing-and-fashion--fabrics": ["Ankara Print Fabric", "Plain Cotton Fabric"], "clothing-and-fashion--handbags": ["Leather-Look Tote Bag", "Crossbody Bag"],
 "clothing-and-fashion--hair-and-wigs": ["Straight Bob Wig"], "clothing-and-fashion--hair-accessories": ["Satin Scrunchie Set"],
 "clothing-and-fashion--childrens-clothes": ["Children's Cotton T-Shirt", "Children's Denim Shorts"], "clothing-and-fashion--womens-clothes": ["Women's Wrap Dress", "Women's Cotton Blouse"],
 "clothing-and-fashion--mens-clothes": ["Men's Polo Shirt", "Men's Chino Trousers"], "clothing-and-fashion--nightwear": ["Satin Pyjama Set"],
 "clothing-and-fashion--unisex-wear": ["Unisex Hoodie"], "clothing-and-fashion--underwear": ["Cotton Briefs Pack"],
 "clothing-and-fashion--waist-trainers": ["Adjustable Waist Trainer"], "clothing-and-fashion--lingerie-and-bralettes": ["Lace Bralette"], "clothing-and-fashion--leggings": ["High-Waist Leggings"],
 "shoes-and-footwear--childrens-shoes": ["Children's School Shoes"], "shoes-and-footwear--womens-shoes": ["Women's Block Heel Sandals"], "shoes-and-footwear--mens-shoes": ["Men's Leather Lace-Up Shoes"],
 "shoes-and-footwear--sneakers": ["Classic White Sneakers", "Running Sneakers"], "shoes-and-footwear--sandals": ["Flat Strap Sandals"], "shoes-and-footwear--slip-ons": ["Canvas Slip-On Shoes"], "shoes-and-footwear--flip-flops": ["Rubber Flip-Flops"],
 "phones-and-accessories--mobile-phones": ["Smartphone (enquire for models)"], "phones-and-accessories--phone-accessories": ["Phone Case", "Fast Charging Cable"], "phones-and-accessories--power-banks": ["Portable Power Bank"],
 "phones-and-accessories--smart-watches": ["Smart Watch"], "phones-and-accessories--ring-lights": ["LED Ring Light with Stand"],
 "gift-sets--gift-sets": ["Luxury Gift Box Set"], "gift-sets--personalised-gift-sets": ["Personalised Gift Hamper"], "gift-sets--seasonal-gift-sets": ["Festive Gift Set"],
 "jewellery--jewellery": ["Jewellery Set"], "jewellery--necklaces": ["Gold-Tone Chain Necklace"], "jewellery--earrings": ["Hoop Earrings"], "jewellery--bracelets": ["Charm Bracelet"], "jewellery--rings": ["Statement Ring"],
 "jewellery--watches-and-jewellery-accessories": ["Jewellery Box"],
 "teas-gummies-and-supplements--fibroid-tea-products": ["Herbal Tea Blend (Fibroid Tea range)"], "teas-gummies-and-supplements--slimming-tea": ["Herbal Tea Blend (Slimming Tea range)"],
 "teas-gummies-and-supplements--flat-tummy-tea": ["Herbal Tea Blend (Flat Tummy Tea range)"], "teas-gummies-and-supplements--gummies": ["Vitamin Gummies"], "teas-gummies-and-supplements--supplements": ["Daily Multivitamin Capsules"],
 "bags-and-luggage--backpacks": ["Everyday Backpack"], "bags-and-luggage--childrens-backpacks": ["Children's Backpack"], "bags-and-luggage--school-bags": ["School Bag"], "bags-and-luggage--travel-bags": ["Travel Duffel Bag", "Hard-Shell Suitcase"],
 "toiletries-and-personal-care-essentials--toilet-tissue": ["Toilet Tissue Pack"], "toiletries-and-personal-care-essentials--diapers": ["Baby Diapers Pack"], "toiletries-and-personal-care-essentials--sanitary-pads": ["Sanitary Pads Pack"],
 "hair-and-hair-accessories--hair-products": ["Hair Care Set"], "hair-and-hair-accessories--hair-accessories": ["Hair Clip Set"], "hair-and-hair-accessories--wigs": ["Long Wavy Wig"],
 "hair-and-hair-accessories--hair-extensions": ["Braiding Hair Extensions"], "hair-and-hair-accessories--hair-styling-accessories": ["Styling Comb and Brush Set"],
 "equipment-medical-equipment-and-farm-tools--equipment": ["Heavy-Duty Work Equipment (enquire)"], "equipment-medical-equipment-and-farm-tools--medical-equipment": ["Digital Blood Pressure Monitor"],
 "equipment-medical-equipment-and-farm-tools--farm-tools": ["Garden Hoe", "Machete"], "equipment-medical-equipment-and-farm-tools--agricultural-equipment": ["Knapsack Sprayer"],
 "cosmetics-and-fragrances--cosmetics": ["Makeup Starter Kit"], "cosmetics-and-fragrances--fragrances": ["Body Mist"], "cosmetics-and-fragrances--perfumes": ["Eau de Parfum"],
 "cosmetics-and-fragrances--perfume-oils": ["Perfume Oil Roll-On"], "cosmetics-and-fragrances--deodorants": ["Roll-On Deodorant"],
 "building-materials-and-fixtures--building-materials": ["Building Materials (enquire)"], "building-materials-and-fixtures--electrical-switches": ["Wall Switch and Socket Set"],
 "building-materials-and-fixtures--lighting-and-fixtures": ["LED Ceiling Light"], "building-materials-and-fixtures--water-closets-wc": ["Water Closet (WC) Set"],
 "building-materials-and-fixtures--sinks": ["Wash Hand Basin"], "building-materials-and-fixtures--plumbing-fixtures": ["Mixer Tap"],
 "other-products--other-items": ["Other Item (enquire)"], "other-products--miscellaneous-products": ["Miscellaneous Product (enquire)"], "other-products--newly-added-categories": ["New Range (to be announced)"],
}
root = os.path.join(os.path.dirname(__file__), "..")
os.makedirs(os.path.join(root, "public/products"), exist_ok=True); os.makedirs(os.path.join(root, "data"), exist_ok=True)
font = lambda n: ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", n)
def tile(path, name):
    im = Image.new("RGB", (800, 800), NAVY); d = ImageDraw.Draw(im)
    d.rectangle([40, 40, 760, 760], outline=GOLD, width=4)
    words, lines, cur = name.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=font(46)) > 600 and cur: lines.append(cur); cur = w
        else: cur = t
    lines.append(cur)
    y = 400 - len(lines) * 32
    for ln in lines: d.text((400 - d.textlength(ln, font=font(46)) / 2, y), ln, fill=WHITE, font=font(46)); y += 64
    d.text((400 - d.textlength("DERA DARKO TRADE", font=font(24)) / 2, 690), "DERA DARKO TRADE", fill=GOLD, font=font(24))
    im.save(path, optimize=True)
rows, n = [], 0
for cat, names in ITEMS.items():
    for name in names:
        n += 1; sku = f"DDT-{n:03d}"
        tile(os.path.join(root, "public/products", f"{sku}.png"), name)
        rows.append({"name": name, "sku": sku, "category": "cat-" + cat, "price_ghs": "", "price_usd": "", "stock": "0", "short_description": f"{name}. Details and price to be confirmed.",
                     "image": f"/products/{sku}.png", "image_alt": name, "availability": "coming_soon", "published": "no"})
with open(os.path.join(root, "data/catalogue-seed.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
print(len(rows), "items")
