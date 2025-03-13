import Fastify from 'fastify'
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { fileURLToPath } from "url";
import path from "path";
import { LlamaChatSession, LlamaContext, LlamaJsonSchemaGrammar, LlamaModel } from "node-llama-cpp";
import cors from '@fastify/cors'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db;

async function initializeDatabase() {
    db = await open({
        filename: path.join(__dirname, 'cache.db'),
        driver: sqlite3.Database
    });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS word_cache (
            id INTEGER PRIMARY KEY,
            first_word TEXT,
            second_word TEXT,
            result TEXT,
            emoji TEXT
        )
    `);
}

initializeDatabase();

const fastify = Fastify({
    logger: true,
    requestTimeout: 60 * 1000
})
await fastify.register(cors, {
    // put your options here
})

async function craftNewWordFromCache(firstWord, secondWord) {
    let cachedResult = await db.get('SELECT result, emoji FROM word_cache WHERE first_word = ? AND second_word = ?', [firstWord, secondWord]);

    if (cachedResult) {
        return cachedResult;
    }

    cachedResult = await db.get('SELECT result, emoji FROM word_cache WHERE first_word = ? AND second_word = ?', [secondWord, firstWord]);

    return cachedResult;
}

async function cacheNewWord(firstWord, secondWord, result, emoji) {
    await db.run('INSERT INTO word_cache (first_word, second_word, result, emoji) VALUES (?, ?, ?, ?)', [firstWord, secondWord, result, emoji]);
}

async function craftNewWord(firstWord, secondWord) {
    const cachedResult = await craftNewWordFromCache(firstWord, secondWord);
    if (cachedResult) {
        return cachedResult;
    }

    console.log(firstWord, secondWord);
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const model = new LlamaModel({
        modelPath: path.join(__dirname, "models", "mistral-7b-instruct-v0.1.Q8_0.gguf"),
    });
    const context = new LlamaContext({model, seed: 0});
    const session = new LlamaChatSession({context});

    const grammar = new LlamaJsonSchemaGrammar({
        "type": "object",
        "properties": {
            "answer": {
                "type": "string"
            },
        }
    });

    const result = await generateWord(firstWord, secondWord, session, grammar, context);

    await cacheNewWord(firstWord, secondWord, result.result, result.emoji);

    return result;
}

async function generateWord(firstWord, secondWord, session, grammar, context) {
    const systemPrompt =
        ‘Vous êtes un assistant précieux qui aide les gens à créer de nouvelles choses en combinant deux mots pour en créer un nouveau.’ +
‘La règle la plus importante à respecter pour chaque réponse est que vous n'êtes pas autorisé à utiliser les mots ' + firstWord + " et " + secondWord +’  dans votre réponse et que vous ne pouvez répondre qu'avec une seule chose.’ +
‘N'INCLUEZ PAS LES MOTS ' + firstWord + " et " + secondWord + ' dans la réponse !!!!! Les mots ' + firstWord + " et " + secondWord + ' ne doivent PAS faire partie de la réponse.’ +
‘Pas de phrases, pas d'expressions, pas de mots multiples, pas de ponctuation, pas de caractères spéciaux, pas de chiffres, pas d'émojis, pas d'URL, pas de code, pas de commandes, pas de programmation.’ +
‘La réponse doit être un nom commun ou un nom propre.’ +
‘L'ordre des deux mots n'a pas d'importance, ils sont tous deux d'importance égale.’ +
‘La réponse doit être liée aux mots et à leur contexte.’ +
‘La réponse peut être une combinaison de mots ou le rôle d'un mot par rapport à l'autre.’ +
‘Les réponses peuvent être des choses (existantes ou non), des matériaux, des personnes, des entreprises, des animaux, des professions, de la nourriture, des lieux, des objets, des émotions, des événements, des concepts, des phénomènes naturels, des parties du corps, des véhicules, des sports, des vêtements, des meubles, des technologies, des bâtiments, des instruments, des boissons, des plantes, des matières académiques et tout ce qui vous vient à l'esprit et qui est un nom commun en français ou un nom propre’

    const emojiSystemPrompt = 'Répondez avec un emoji correspondant au mot. Utilisez l'encodage UTF-8.';
    const answerPrompt = 'Répondez avec le résultat de ce qui se passerait si vous combiniez ' + firstWord + " et " + secondWord + '. 
La réponse doit être liée aux mots et au contexte des mots et ne peut pas contenir les mots exactes eux-mêmes. '

    const q1 = firstWord + " et " + secondWord + " . ";

    const promp = '<s>[INST] ' +
        systemPrompt +
        answerPrompt + '[/INST]</s>\n';

    const result = await session.prompt(promp, {
        grammar,
        maxTokens: context.getContextSize()
    });


    const emojiPrompt = '<s>[INST] ' +
        emojiSystemPrompt +
        JSON.parse(result).answer + '[/INST]</s>\n';

    const emojiResult = await session.prompt(emojiPrompt, {
        grammar,
        maxTokens: context.getContextSize()
    });

    if (JSON.parse(result).answer.toLowerCase().trim().split(' ').length > 3 ||
        (JSON.parse(result).answer.toLowerCase().includes(firstWord.toLowerCase()) &&
            JSON.parse(result).answer.toLowerCase().includes(secondWord.toLowerCase()) &&
            JSON.parse(result).answer.length < (firstWord.length + secondWord.length + 2))
    ) {
        return {result: '', emoji: ''}
    }
    return {result: capitalizeFirstLetter(JSON.parse(result).answer), emoji: JSON.parse(emojiResult).answer}
}

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}


fastify.route({
    method: 'GET',
    url: '/',
    schema: {
        // the response needs to be an object with an `hello` property of type 'string'
        response: {
            200: {
                type: 'object',
                properties: {
                    'Eau + Feu': {type: 'string'},
                    'Eau + Terre': {type: 'string'},
                    'Feu + Terre': {type: 'string'},
                    'Eau + Air': {type: 'string'},
                    'Terre + Air': {type: 'string'},
                    'Feu + Air': {type: 'string'}
                }
            }
        },
    },
    // this function is executed for every request before the handler is executed
    preHandler: async (request, reply) => {
        // E.g. check authentication
    },
    handler: async (request, reply) => {
        reply.type('application/json').code(200)

        return {
            'Eau + Feu': (await craftNewWord('Eau', 'Feu')),
            'Eau + Terre': (await craftNewWord('Eau', 'Terre')),
            'Feu + Terre': (await craftNewWord('Feu', 'Terre')),
            'Eau + Air': (await craftNewWord('Eau', 'Air')),
            'Terre + Air': (await craftNewWord('Terre', 'Air')),
            'Feu + Air': (await craftNewWord('Feu', 'Air'))
        }
    }
})

fastify.route({
    method: 'POST',
    url: '/',
    schema: {
        // the response needs to be an object with an `hello` property of type 'string'
        response: {
            200: {
                type: 'object',
                properties: {
                    result: {type: 'string'},
                    emoji: {type: 'string'}
                }
            }
        }
    },
    // this function is executed for every request before the handler is executed
    preHandler: async (request, reply) => {
        // E.g. check authentication
    },
    handler: async (request, reply) => {

        if (!request?.body?.first || !request?.body?.second) {
            return;
        }

        const firstWord = capitalizeFirstLetter(request.body.first.trim().toLowerCase());
        const secondWord = capitalizeFirstLetter(request.body.second.trim().toLowerCase());
        reply.type('application/json').code(200)

        return await craftNewWord(firstWord, secondWord)
    }
})

try {
    await fastify.listen({port: 3000, host: '0.0.0.0'})
} catch (err) {
    fastify.log.error(err)
    process.exit(1)
}
