/* Encounters (wiki ItemData module). */
import type { Encounter } from '../core/types';

export const ENCOUNTERS: Encounter[] = [
  {
    name: 'Priest',
    day: 3,
    o: [
      ['Healing Touch', 'Increase your Max HP by 100% and gain +10 Gold.'],
      ['Blessing', 'Gain +300 Max HP and +10 Income.'],
    ],
  },
  {
    name: 'Blacksmith',
    day: 4,
    o: [
      ['Upgrade!', 'Give a weapon +8 damage and +30% crit chance.'],
      ['Heavy Armor', 'Start each fight with 10% max hp as shield.'],
    ],
  },
  {
    name: 'Home Brewer',
    day: 4,
    o: [
      ['Ask About His Hidden Drawer', 'Gain 2 random vials.'],
      ['Try the Home-Brew', 'Gain a Home-Brew with random stats.'],
    ],
  },
  {
    name: 'Traveller',
    day: 4,
    o: [
      ['Freerolls', 'Gain 2 free rerolls and +2 free rerolls each day (can accumulate).'],
      ["Traveller's Stock", 'Gain 4x Cloud in a Vial.'],
    ],
  },
  {
    name: 'Pirate',
    day: 4,
    o: [
      ['Hooked', 'Gain a Hook with 30% extra crit chance.'],
      ['Plunder', 'Gain a Goblet and 10 gold.'],
    ],
  },
  {
    name: 'Warrior',
    day: 4,
    o: [
      ['Weapon Loot', 'Gain 2 random common weapons.'],
      ['Sharpen', 'Give your weapons +6 damage permanently.'],
    ],
  },
  {
    name: 'Shieldbearer',
    day: 4,
    o: [
      ['Take My Shield', 'Gain a Lifeguard with +1 multicast.'],
      ['Shield Mastery', 'Give a shield +1 multicast and +10 shield.'],
    ],
  },
  {
    name: 'Potion Seller',
    day: 4,
    o: [
      ['Regular Stock', 'Get a random weapon-buff potion.'],
      ['Special Stock', 'Gain a Value Potion.'],
    ],
  },
  {
    name: 'Katya',
    day: 4,
    o: [
      ['Take My Spear', 'Gain a Refined Spear with +10 dmg and +5 random types.'],
      ['Lemons & Limes', 'Slice Lemons and Limes to earn gold. Drag a Sword, Dagger or Axe here to start.'],
    ],
  },
  {
    name: 'Elven Archer',
    day: 6,
    o: [
      ['Take my Bow', 'Gain a Regular Bow with Elven and +4 Multicast.'],
      ['Elven Favor', 'Gain an artillery slot.'],
    ],
  },
  {
    name: 'Sage',
    day: 6,
    o: [
      ['Sacred Touch', 'Gain a vitality slot.'],
      ['Holy Favor', 'Gain a Mending Serum and a Healing Word with +1 Multicast.'],
    ],
  },
  {
    name: 'Salesman',
    day: 6,
    o: [
      ['Bargain Contract', 'Some items in the shop will be on sale.'],
      ['Discount License', 'Gain 15 gold. Reduce the cost of rerolls by 1 gold.'],
    ],
  },
  {
    name: 'Elder',
    day: 6,
    o: [
      ['Learn by Doing', 'Gain 16 XP. Permanent buff: gain +16 XP per day.'],
      ['Instant Knowledge', 'Gain 40 XP'],
    ],
  },
  {
    name: 'Enchanter',
    day: 6,
    o: [
      ['Enchant', 'Upgrade a common or rare item (up to 2 star).'],
      ['Discover Item', 'Gain an epic chest reward.'],
    ],
  },
  {
    name: 'Chronomancer',
    day: 6,
    o: [
      ['Request Potion', 'Gain a Time Tonic.'],
      ['Request Artifact', 'Gain a Time Pendant.'],
    ],
  },
  {
    name: 'Granny',
    day: 6,
    o: [
      ['Check her assortment.', 'A shop containing 7 potions.'],
      ['Steal', "Steal 1 potion from Granny's assortment.."],
    ],
  },
  {
    name: 'Cleric',
    day: 8,
    o: [
      ['Lifesurge', 'Gain +2000 max health and regain 2 lives'],
      ['Vitality', 'Gain +2500 max health.'],
    ],
  },
  {
    name: 'Carmen',
    day: 9,
    o: [
      ['Lucky Rerolls', 'Gain +15% luck.'],
      ['Walk on Water', 'Permanently reduce CD of all your items by 0.3s.'],
    ],
  },
  {
    name: 'Lyra',
    day: 9,
    o: [
      ['Northern Blessing', 'Gain a Frozen Orb and make an item Frosty.'],
      ['Absolute Zero', 'Drag to freeze individual items. They persist through rerolls and become likelier to appear.'],
    ],
  },
  {
    name: 'Count Vlado',
    day: 9,
    o: [
      ['Gain His Amulet', 'Gain a tripled Nightquill.'],
      ['Cursed Artifact', 'Discover a Cursed Artifact.'],
    ],
  },
  {
    name: 'Celestia',
    day: 9,
    o: [
      ['Special Gift', 'Gain 15 gold and a Mirror Elixir.'],
      ['Wish', 'Upgrade a 2* item to 3* in 2 days.'],
    ],
  },
  {
    name: 'Master Alderos',
    day: 9,
    o: [
      ['Ascendence', 'Upgrade an epic item or below.'],
      ['Wisdom', 'Fill your tower with random slot buffs.'],
    ],
  },
  {
    name: 'King Midas',
    day: 9,
    o: [
      ['Make an Offering', 'Pay 20 gold and gain a random blessing chosen from 2.'],
      ['Accept some valuables', 'Gain 1x Treasure Chest.'],
    ],
  },
  {
    name: "Drakk'Zar",
    day: 9,
    o: [
      ["Dragon's Hoard", "Tomorrow: Find the Dragon's Hoard."],
      ['Sharp Claws', 'Give an item +80% Crit Chance.'],
    ],
  },
  {
    name: 'Bishop',
    day: 11,
    o: [
      ['Exaltation', 'Gain +7000 max health and give all your items +15 damage.'],
      ['Benediction', 'Gain +6500 max health and 3 lucky rerolls.'],
    ],
  },
  {
    name: 'Shady Dealer',
    day: 18,
    o: [
      ['No Thanks', 'Refuse the offer and pickpocket 5 gold from the dealer.'],
      ['Listen, Kid..', 'Lose 15 rating points. Day 23: Gain +30 rating points.'],
    ],
  },
  {
    name: 'Miriel',
    day: null,
    o: [
      ['Toss a Coin to Your Angel', 'Revive with 2 life and gain 45 gold.'],
      ['Answer the Call', 'Revive with 2 lives, gain 16 XP and gain 1 epic chest.'],
    ],
  },
  {
    name: 'Mr. Spook (seasonal)',
    day: 6,
    o: [
      ['Trick or Treat', 'Candy will now appear in the shop.'],
      ['Witch Bargain', 'Gain a Brew Today.'],
    ],
  },
  {
    name: 'Nicholas (seasonal)',
    day: 9,
    o: [
      ['Wheel of Fortune', 'Price 8 gold. Increase by +3 gold per spin.'],
      ['Presents!', 'Present will now appear in the shop'],
    ],
  },
];
