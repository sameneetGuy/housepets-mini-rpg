export function rollDice(formula) {
    const match = /^(\d+)d(\d+)([+-]\d+)?$/.exec(formula);
    if (!match) return 0;

    const num = parseInt(match[1]);
    const sides = parseInt(match[2]);
    const mod = match[3] ? parseInt(match[3]) : 0;

    let total = 0;
    for (let i = 0; i < num; i++) {
        total += Math.floor(Math.random() * sides) + 1;
    }
    return total + mod;
}
