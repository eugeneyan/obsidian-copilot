import { App, Editor, MarkdownView, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

// Remember to rename these classes and interfaces!
interface CopilotPluginSettings {
	model: string;
	apiKey: string;
	systemContentDraftSection: string;
	systemContentDraftSectionNoContext: string;
	systemContentReflectWeek: string;
}

const DEFAULT_SETTINGS: CopilotPluginSettings = {
	model: 'gpt-3.5-turbo',
	apiKey: 'sk-xxxxxxxxxx',
	systemContentDraftSection: "You are Obsidian-Copilot, a friendly AI assistant that helps writers craft drafts based on their notes.\n\nYour task is to generate a few paragraphs based on a given section heading and related context of documents. When you reference content from a document, append the sentence with a markdown reference that links to the document's title. For example, if a sentence references context from 'Augmented Language Models.md', it should end with ([source](Augmented%20Language%20Models.md)).",
	systemContentDraftSectionNoContext: "You are Obsidian-Copilot, a friendly AI assistant that helps writers craft drafts based on their notes.\n\nYour task is to generate a few paragraphs based on a given section heading.",
	systemContentReflectWeek: "You are a friendly AI therapist that helps users reflect on their week and evoke feelings of gratitude, positivity, joy for life. Given their journal entries, write a paragraph for each of the following:\n\n* Celebrate what went well\n* Reflect on areas for growth\n* Suggest goals for next week"
}

export default class CopilotPlugin extends Plugin {
	settings: CopilotPluginSettings;
	processing = false;

	// Opens a new pane to display the retrieved docs
	async openNewPane(content: string) {
		const filename = 'Retrieved docs.md';
		let file = this.app.vault.getAbstractFileByPath(filename) as TFile;

		if (file) {
			await this.app.vault.modify(file, content);
		} else {
			file = await this.app.vault.create(filename, content);
		}

		// Check if there is already an open pane with the file
		const existingLeaf = this.app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file && leaf.view.file.path === file.path);

		if (existingLeaf) {
			// If a pane with the file already exists, just set the content
			(existingLeaf.view as MarkdownView).editor.setValue(content);
		} else {
			// If no pane with the file exists, create a new one
			const leaf = this.app.workspace.getLeaf('split', 'vertical');
			leaf.openFile(file);
		}
	}


	private async queryLLM(messages: Array<any>, model: string, temperature = 0.7) {
		return await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.settings.apiKey}`
			},
			body: JSON.stringify({
				'model': model,
				'temperature': temperature,
				'messages': messages,
				'stream': true
			})
		});
	}

	async onload() {
		await this.loadSettings();

		async function parseStream(reader: any, editor: Editor): Promise<void> {
			let buffer = '';
			const { value, done } = await reader.read();

			if (done) {
				statusBarItemEl.setText('Done with Copilot task!');
				return;
			}

			const decoded = new TextDecoder().decode(value);
			buffer += decoded;
			let start = 0;
			let end = buffer.indexOf('\n');

			while (end !== -1) {
				const message = buffer.slice(start, end);
				start = end + 1;

				try {
					const messageWithoutPrefix = message.replace('data: ', '');
					const json = JSON.parse(messageWithoutPrefix);

					let lastToken = '';

					if (json.choices && json.choices.length > 0 && json.choices[0].delta && json.choices[0].delta.content) {
						let token = json.choices[0].delta.content;

						// If token is a space, append it to last token
						if (token === ' ') {
							lastToken += token;
							token = lastToken;
						} else {
							// Save the last non-space token
							lastToken = token;
						}

						// Replace in the editor
						editor.replaceSelection(token);
					}

				} catch (err) {
					// console.error('Failed to parse JSON: ', err);
				}
				end = buffer.indexOf('\n', start);
			}
			buffer = buffer.slice(start);
			requestAnimationFrame(() => parseStream(reader, editor));
		}

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Copilot loaded');

		// Editor command that drafts a section given the section heading and context
		this.addCommand({
			id: 'copilot-draft-section',
			name: 'Draft Section',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				const query = selection.replace(/[^a-z0-9 ]/gi, '');
				statusBarItemEl.setText('Running Copilot...');

				// Retrieve relevant chunks from the server
				const restResponse = await fetch(`http://0.0.0.0:8000/get_chunks?query=${encodeURIComponent(query)}`);
				console.log('response', restResponse);
				if (!restResponse.ok) {
					console.error('An error occurred while fetching chunks', await restResponse.text());
					statusBarItemEl.setText('ERROR: No response from retrieval API');
					return;
				}

				const restData = await restResponse.json();
				const retrievedDocs = [];
				const relevantContent = [];
				for (let i = 0; i < restData.length; i++) {
					// Assuming ttile and chunk keys are always present in each dictionary
					retrievedDocs.push(`[[${restData[i].title}]]\n\n${restData[i].chunk}`);
					relevantContent.push(`Title: ${restData[i].title}\nContext: ${restData[i].chunk}\n`);
				}
				const retrievedDocsDisplay = retrievedDocs.join('\n---\n');
				console.log(`PARSED RETRIEVED DOCS: \n\n${retrievedDocsDisplay}`);

				this.openNewPane(retrievedDocsDisplay);

				// Create user content
				const user_content = `Section heading: ${query}\n\n${relevantContent.join('---\n')}\n\nDraft:`;
				console.log(`USER CONTENT:\n\n${user_content}`);

				// Send messages to OpenAI
				const messages = [
					{ 'role': 'system', 'content': this.settings.systemContentDraftSection },
					{ 'role': 'user', 'content': user_content }
				]
				const response = await this.queryLLM(messages, this.settings.model, 0.7);

				if (!response.ok) {
					const errorData = await response.json();
					console.error('An error occurred', errorData);
					statusBarItemEl.setText('ERROR: No response from LLM API');
				} else {
					const reader = response.body?.getReader();
					editor.replaceSelection(selection + '\n\n');

					await parseStream(reader, editor);
				}
			}
		});

		// Editor command that drafts a section given the section heading ONLY
		this.addCommand({
			id: 'copilot-draft-section-no-context',
			name: 'Draft Section (no context)',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				const query = selection.replace(/[^a-z0-9 ]/gi, '');
				statusBarItemEl.setText('Running Copilot...');

				// Create user content
				const user_content = `Section heading: ${query}\n\nDraft:`;
				console.log(`USER CONTENT:\n\n${user_content}`);

				// Send messages to OpenAI
				const messages = [
					{ 'role': 'system', 'content': this.settings.systemContentDraftSectionNoContext },
					{ 'role': 'user', 'content': user_content }
				]
				const response = await this.queryLLM(messages, this.settings.model, 0.7);

				if (!response.ok) {
					const errorData = await response.json();
					console.error('An error occurred', errorData);
					statusBarItemEl.setText('ERROR: No response from LLM API');
				} else {
					const reader = response.body?.getReader();
					editor.replaceSelection(selection + '\n\n');

					await parseStream(reader, editor);
				}
			}
		});

		this.addCommand({
			id: 'copilot-reflect-week',
			name: 'Reflect on the week',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				statusBarItemEl.setText('Running Copilot...');

				// Get the date from the note's title
				const titleDateStr = view.file.basename;
				const date = new Date(titleDateStr);
				console.log(`Date: ${date.toISOString().slice(0, 10)}`);

				let pastContent = '';
				for (let i = 0; i < 7; i++) {
					const dateStr = date.toISOString().slice(0, 10);
					const dailyNote = this.app.vault.getAbstractFileByPath(`daily/${dateStr}.md`);
					console.log(`dateStr: ${dateStr}, dailyNote: ${dailyNote}`);
					if (dailyNote && dailyNote instanceof TFile) {
						const noteContent = await this.app.vault.read(dailyNote);
						console.log(`dateStr: ${dateStr}, dailyNote: ${dailyNote}, noteContent:\n\n${noteContent}`);
						pastContent += `Date: ${dateStr}\n\nJournal entry:\n${noteContent}\n---\n`;
					}
					date.setDate(date.getDate() - 1);
				}
				console.log(`PAST JOURNAL ENTRIES: \n\n${pastContent}`);

				this.openNewPane(pastContent);

				// Create user content
				const user_content = `These are the journal entries for my week:\n${pastContent}\n\nReflection:`;
				console.log(`USER CONTENT:\n\n${user_content}`);

				// Send messages to OpenAI
				const messages = [
					{ 'role': 'system', 'content': this.settings.systemContentReflectWeek },
					{ 'role': 'user', 'content': user_content }
				]
				const response = await this.queryLLM(messages, this.settings.model, 0.7);

				if (!response.ok) {
					const errorData = await response.json();
					console.error('An error occurred', errorData);
					statusBarItemEl.setText('ERROR: No response from LLM API');
				} else {
					const reader = response.body?.getReader();
					editor.replaceSelection('\n');

					await parseStream(reader, editor);
				}
			}
		});


		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new CopilotSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class CopilotSettingTab extends PluginSettingTab {
	plugin: CopilotPlugin;

	constructor(app: App, plugin: CopilotPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Settings for Obsidian Copilot' });

		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Enter your OpenAI API key')
			.addText(text => text
				.setPlaceholder('API Key')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Model Name')
			.setDesc('Enter the model used for generation')
			.addText(text => text
				.setPlaceholder('Model name')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('System Prompt: Draft Section')
			.setDesc('Define the prompt used for drafting a section with context')
			.addText(text => text
				.setPlaceholder('Prompt to draft a section')
				.setValue(this.plugin.settings.systemContentDraftSection)
				.onChange(async (value) => {
					this.plugin.settings.systemContentDraftSection = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('System Prompt: Draft Section (without context)')
			.setDesc('Define the prompt used for drafting a section without context')
			.addText(text => text
				.setPlaceholder('Prompt to draft a section (without context)')
				.setValue(this.plugin.settings.systemContentDraftSectionNoContext)
				.onChange(async (value) => {
					this.plugin.settings.systemContentDraftSectionNoContext = value;
					await this.plugin.saveSettings();
				}));


		new Setting(containerEl)
			.setName('System Prompt: Reflect on the week')
			.setDesc('Define the prompt used` to reflect on the week')
			.addText(text => text
				.setPlaceholder('Prompt to reflect on the week')
				.setValue(this.plugin.settings.systemContentReflectWeek)
				.onChange(async (value) => {
					this.plugin.settings.systemContentReflectWeek = value;
					await this.plugin.saveSettings();
				}));
	}
}