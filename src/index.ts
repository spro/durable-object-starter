import { DurableObject } from "cloudflare:workers"
import { Hono } from "hono"
import { cors } from "hono/cors"

type Env = {
    Bindings: {
        MY_DURABLE_OBJECT: DurableObjectNamespace<MyDurableObject>
    }
}

export class MyDurableObject extends DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env)
    }

    async fetch(request: Request): Promise<Response> {
        const websocketPair = new WebSocketPair()
        const [client, server] = Object.values(websocketPair)
        this.ctx.acceptWebSocket(server)
        return new Response(null, { status: 101, webSocket: client })
    }

    async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
        // Upon receiving a message from the client, the server replies with the same message,
        // and the total number of connections with the "[Durable Object]: " prefix
        // ws.send(`[Durable Object] message: ${message}, connections: ${this.ctx.getWebSockets().length}`)
        ws.send(JSON.stringify({ hello: "world" }))
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
        // If the client closes the connection, the runtime will invoke the webSocketClose() handler.
        ws.close(code, "Durable Object is closing WebSocket")
    }

    async setGreeting(value: string): Promise<void> {
        await this.ctx.storage.put("greeting", value)
        for (const connection of this.ctx.getWebSockets()) {
            connection.send(JSON.stringify({ greeting: value }))
        }
    }

    async getGreeting(): Promise<string> {
        return (await this.ctx.storage.get("greeting")) || "Hello"
    }

    async sayHello(name: string): Promise<string> {
        const greeting = await this.getGreeting()
        return `${greeting}, ${name}!`
    }
}

const app = new Hono<Env>()

app.get("/ws", async (c) => {
    if (c.req.header("upgrade") !== "websocket") {
        return c.text("Expected websocket request", 426)
    }
    const id = c.env.MY_DURABLE_OBJECT.idFromName("foo")
    const stub = c.env.MY_DURABLE_OBJECT.get(id)
    return stub.fetch(c.req.raw)
})

app.use(
    "*",
    cors({
        origin: ["http://localhost:5173", "https://durable-object-frontend.pages.dev"],
        allowHeaders: ["Origin", "Content-Type", "Authorization"],
        allowMethods: ["GET", "OPTIONS", "POST", "PUT", "DELETE"],
        credentials: true,
    })
)

app.get("/", async (c) => {
    const name = c.req.query("name") || "world"
    const id: DurableObjectId = c.env.MY_DURABLE_OBJECT.idFromName("foo")
    const stub = c.env.MY_DURABLE_OBJECT.get(id)
    const greeting = await stub.sayHello(name)

    return c.text(greeting)
})

app.get("/greeting", async (c) => {
    const id: DurableObjectId = c.env.MY_DURABLE_OBJECT.idFromName("foo")
    const stub = c.env.MY_DURABLE_OBJECT.get(id)
    const greeting = await stub.getGreeting()

    return c.text(greeting)
})

app.post("/greeting", async (c) => {
    const id: DurableObjectId = c.env.MY_DURABLE_OBJECT.idFromName("foo")
    const stub = c.env.MY_DURABLE_OBJECT.get(id)
    const greeting = await c.req.text()
    await stub.setGreeting(greeting)

    return c.text(`Set greeting to "${greeting}"`)
})

export default app
