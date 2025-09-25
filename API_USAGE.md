# API Chat avec Qdrant - Guide d'utilisation

## 🚀 Démarrage rapide

### 1. Configuration
Créez un fichier `.env` à la racine du projet avec :
```env
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=your_qdrant_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
PORT=3000
NODE_ENV=development
```

### 2. Installation des dépendances
```bash
npm install
```

### 3. Démarrage de l'application
```bash
npm run start:dev
```

## 📡 Endpoints disponibles

### POST /chat
Envoie une question au chatbot et récupère une réponse basée sur les documents Qdrant.

**Request Body:**
```json
{
  "question": "Quelle est la loi sur le travail ?",
  "sessionId": "optional-session-id"
}
```

**Response:**
```json
{
  "answer": "Basé sur les documents trouvés...",
  "relevantDocuments": [
    {
      "id": "doc1",
      "score": 0.95,
      "payload": {
        "text": "Contenu du document...",
        "metadata": {}
      }
    }
  ],
  "sessionId": "session_1234567890_abc123",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### DELETE /chat/:sessionId
Efface l'historique de conversation pour une session donnée.

**Response:**
```json
{
  "message": "Conversation effacée avec succès"
}
```

### GET /chat/health
Vérifie l'état de santé de l'API.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## 🏗️ Architecture

```
User Question → ChatController → ChatService → [Mongo VectorSearch + MemoryService + LangChainService] → Response
```

### Services créés :

1. **Mongo VectorSearch** : Recherche sémantique via `$vectorSearch` sur `embedding`
2. **EmbeddingService** : Hugging Face `Xenova/all-MiniLM-L6-v2` (384)
3. **MemoryService** : Mémorisation des conversations
4. **LangChainService** : Génère des réponses intelligentes (OpenAI si configuré)
5. **ChatService** : Orchestrateur
6. **ChatController** : API REST

## ✅ Fonctionnalités implémentées

1. **✅ Intégration LangChain** : Génération de réponses intelligentes avec GPT-3.5-turbo
2. **✅ Embeddings** : Conversion des questions en vecteurs avec OpenAI
3. **✅ Recherche vectorielle** : Recherche sémantique dans Qdrant
4. **✅ Mémoire conversationnelle** : Historique des conversations par session
5. **✅ API REST** : Endpoints pour chat, gestion des sessions et santé

## 🔧 Prochaines étapes

1. **Persistance** : Sauvegarde des conversations en base de données
2. **Authentification** : Sécurisation des endpoints
3. **Optimisation** : Cache des embeddings et amélioration des performances
4. **Tests** : Tests unitaires et d'intégration

## 🧪 Test de l'API

```bash
# Test de santé
curl http://localhost:3000/chat/health

# Test d'une question
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "Quelle est la loi sur le travail ?"}'
```
