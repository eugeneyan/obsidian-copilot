import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { spinnersPlugin } from "./spinner";
import { EditorView } from "@codemirror/view";

// Remember to rename these classes and interfaces!
interface CopilotPluginSettings {
	apiKey: string;
	systemContent: string;
}

const DEFAULT_SETTINGS: CopilotPluginSettings = {
	apiKey: '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',
	systemContent: 'You are Obsidian-Copilot, a friendly assistant that helps users flesh out ideas and write easier.\n Given a section heading and relevant documents, you will generate a few paragraphs based on the relevant document. Please also augment the generated text your own knowledge.'
}

export default class CopilotPlugin extends Plugin {
	settings: CopilotPluginSettings;
	processing = false;

	getActiveView() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView !== null) {
			return activeView;
		} else {
			new Notice("The file type should be Markdown!");
			return null;
		}
	}

	startProcessing(showSpinner = true) {
		this.processing = true;
		const activeView = this.getActiveView();
		if (activeView !== null && showSpinner) {
			const editor = activeView.editor;
			// @ts-expect-error, not typed
			const editorView = activeView.editor.cm as EditorView;
			const plugin = editorView.plugin(spinnersPlugin);

			if (plugin) {
				plugin.add(
					editor.posToOffset(editor.getCursor("to")),
					editorView
				);
				this.app.workspace.updateOptions();
			}
		}
	}

	endProcessing(showSpinner = true) {
		this.processing = false;
		const activeView = this.getActiveView();
		if (activeView !== null && showSpinner) {
			const editor = activeView.editor;
			// @ts-expect-error, not typed
			const editorView = activeView.editor.cm as EditorView;
			const plugin = editorView.plugin(spinnersPlugin);

			if (plugin) {
				plugin.remove(
					editor.posToOffset(editor.getCursor("to")),
					editorView
				);
			}
		}
	}

	async openNewPane(content: string) {
		const filename = 'Retrieved docs.md';
		const file = this.app.vault.getAbstractFileByPath(filename);

		if (file) {
			await this.app.vault.delete(file);
		}

		const newFile = await this.app.vault.create(filename, content);
		const leaf = this.app.workspace.getLeaf('split', 'horizontal');
		leaf.openFile(newFile);
	}

	async onload() {
		await this.loadSettings();
		this.registerEditorExtension(spinnersPlugin);
		this.app.workspace.updateOptions();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Copilot', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('Copilot loaded');
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Copilot loaded');

		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'copilot-autocomplete',
			name: 'Autocomplete',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				statusBarItemEl.setText('Running Copilot...');
				this.startProcessing();  // Not working for some reason

				// Retrieve relevant chunks from the server
				const restResponse = await fetch(`http://0.0.0.0:8000/get_chunks?query=${encodeURIComponent(selection)}`);
				console.log('response', restResponse);
				if (!restResponse.ok) {
					console.error('An error occurred while fetching chunks', await restResponse.text());
					statusBarItemEl.setText('ERROR: No response from retrieval API');
					return;
				}

				const restData = await restResponse.json();
				const result = restData.join('\n');

				this.openNewPane(restData.join('\n\n'));

				// Create user content
				const user_content = `Section heading: ${selection}\nRelevant Content: ${result}`;

				// Send messages to OpenAI
				const response = await fetch('https://api.openai.com/v1/chat/completions', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${this.settings.apiKey}`
					},
					body: JSON.stringify({
						'model': 'gpt-3.5-turbo',
						'messages': [
							{ 'role': 'system', 'content': this.settings.systemContent },
							{ 'role': 'user', 'content': user_content }
						]
					})
				});

				if (!response.ok) {
					const errorData = await response.json();
					console.error('An error occurred', errorData);
					statusBarItemEl.setText('ERROR: No response from LLM API');
				} else {
					const data = await response.json();
					const completion = data.choices[0].message.content;
					console.log('completion', completion);
					editor.replaceSelection(selection + '\n\n' + completion.trim());
					statusBarItemEl.setText('Copilot complete!');
					this.endProcessing();
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
	}
}
