# House rules

This is the game's implemented Thirty-One / Blitz variant. The setup screen exposes the supported variations.

## A hand

Each player gets three cards. Aces count 11, face cards count 10, and numbered cards count their printed value. Add cards of one suit and keep the highest suit total. Three matching ranks have no special bonus.

A three-card suited 31 is Blitz. It ends the round immediately and each active rival pays one token. An opening deal containing Blitz is resolved immediately, including multiple simultaneous opening Blitz hands.

## A turn

Before drawing, either knock or take one card from the face-down stock or the top of the discard pile. After drawing, choose one card to discard. A card taken face-up from the discard pile must stay in your hand for that turn. A card drawn blindly from stock may be discarded immediately.

Knocking ends your turn without drawing. Opening-turn knocks are legal. Each other active player then gets one final turn. The knocker receives no additional turn. A Blitz during those turns still ends the round immediately.

When stock runs out, compare hands after the final discard.

## Default payout

Players start with four tokens. Only the lowest hand pays one token after a normal showdown. For example, if the knocker has 22 and rivals finish on 26, 20, and 17, only the 17 pays.

A failed knock has no additional penalty beyond the normal token loss. If the knocker is uniquely lowest, they pay one token.

If the knocker ties for lowest, the default rule protects the knocker and charges the other players in that low tie. If the knocker is above a low tie, everyone tied at the bottom pays one.

A round that would eliminate every player together is replayed with the existing tokens. The match ends when one player remains. There is no extra free ride at zero tokens.

## Setup variations

| Setting | Choices | Default |
| --- | --- | --- |
| Seats | 2–4 | 4 |
| Starting tokens | 1–6 | 4 |
| Showdown payout | Lowest hand pays, or everyone below the highest pays | Lowest hand pays |
| Knocker tied for lowest | Knocker safe and other tied players pay, or only knocker pays | Knocker safe |
| Bot style | Arcade or table reader | Arcade |

Triples remain ordinary suit-scored hands. The failed-knock cost remains one. Blitz charges active rivals under either payout setting.

## End a game

For solo play, **Game menu → End game and go to lobby** clears the saved hand. Reloading stays in the lobby.

An online host ends the room for everyone. A guest leaves their seat to a bot. The confirmation screen explains which operation will occur.

Traditional Thirty-One has many variants. The implemented behavior is covered by `checks/table.test.mjs`. The external rules reference used during development is [Pagat's Thirty-One page](https://www.pagat.com/draw/scat.html).
